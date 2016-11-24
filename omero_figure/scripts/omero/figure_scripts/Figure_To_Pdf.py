
#
# Copyright (c) 2014-2015 University of Dundee.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.
#

import json
import unicodedata

from datetime import datetime
import os
from os import path
import zipfile
from math import atan, sin, cos, sqrt, radians

from omero.model import ImageAnnotationLinkI, ImageI
import omero.scripts as scripts

from cStringIO import StringIO
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    import Image
    import ImageDraw

try:
    import markdown
    markdown_imported = True
except ImportError:
    markdown_imported = False

try:
    from reportlab.pdfgen import canvas
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph
    reportlab_installed = True
except ImportError:
    reportlab_installed = False


from omero.gateway import BlitzGateway
from omero.rtypes import rstring, robject

ORIGINAL_DIR = "1_originals"
RESAMPLED_DIR = "2_pre_resampled"
FINAL_DIR = "3_final"

README_TXT = """These folders contain images used in the creation
of the figure. Each folder contains one image per figure panel,
with images numbered according to the order they were added to
the figure. The numbered folders represent the sequence of
processing steps:

 - 1_originals: This contains the full-sized and un-cropped images that are
   rendered by OMERO according to your chosen rendering settings.

 - 2_pre_resampled: This folder will only contain those images that are
   resampled in order to match the export figure resolution. This will be
   all panels for export of TIFF figures. For export of PDF Figures,
   only panels that have a 'dpi' set, which is higher than their
   existing resolution will be resampled.

 - 3_final: These are the image panels that are inserted into the
   final figure, saved following any cropping, rotation and resampling steps.
"""


def compress(target, base):
    """
    Creates a ZIP recursively from a given base directory.

    @param target:      Name of the zip file we want to write E.g.
                        "folder.zip"
    @param base:        Name of folder that we want to zip up E.g. "folder"
    """
    zip_file = zipfile.ZipFile(target, 'w')
    try:
        for root, dirs, files in os.walk(base):
            archive_root = os.path.relpath(root, base)
            for f in files:
                fullpath = os.path.join(root, f)
                archive_name = os.path.join(archive_root, f)
                zip_file.write(fullpath, archive_name)
    finally:
        zip_file.close()


class ShapeToPdfExport(object):

    def __init__(self, canvas, panel, page, crop, page_height):

        self.canvas = canvas
        self.panel = panel
        self.page = page
        # The crop region on the original image coordinates...
        self.crop = crop
        self.page_height = page_height
        # Get a mapping from original coordinates to the actual size of panel
        self.scale = float(panel['width']) / crop['width']

        if "shapes" in panel:
            for shape in panel["shapes"]:
                if shape['type'] == "Arrow":
                    self.drawArrow(shape)
                elif shape['type'] == "Line":
                    self.drawLine(shape)
                elif shape['type'] == "Rectangle":
                    self.drawRectangle(shape)
                elif shape['type'] == "Ellipse":
                    self.drawEllipse(shape)

    def getRGB(self, color):
        # Convert from E.g. '#ff0000' to (255, 0, 0)
        red = int(color[1:3], 16)
        green = int(color[3:5], 16)
        blue = int(color[5:7], 16)
        return (red, green, blue)

    def panelToPageCoords(self, shape_x, shape_y):
        """
        Convert coordinate from the image onto the PDF page.
        Handles zoom, offset & rotation of panel, rotating the
        x, y point around the centre of the cropped region
        and scaling appropriately.
        Also includes 'inPanel' key - True if point within
        the cropped panel region
        """
        rotation = self.panel['rotation']
        # img coords: centre of rotation
        cx = self.crop['x'] + (self.crop['width']/2)
        cy = self.crop['y'] + (self.crop['height']/2)
        dx = cx - shape_x
        dy = cy - shape_y
        # distance of point from centre of rotation
        h = sqrt(dx * dx + dy * dy)
        # and the angle (avoid division by zero!)
        if dy == 0:
            angle1 = 90
        else:
            angle1 = atan(dx/dy)
            if (dy < 0):
                angle1 += radians(180)

        # Add the rotation to the angle and calculate new
        # opposite and adjacent lengths from centre of rotation
        angle2 = angle1 - radians(rotation)
        newo = sin(angle2) * h
        newa = cos(angle2) * h
        # to give correct x and y within cropped panel
        shape_x = cx - newo
        shape_y = cy - newa

        # convert to coords within crop region
        shape_x = shape_x - self.crop['x']
        shape_y = shape_y - self.crop['y']
        # check if points are within panel
        in_panel = True
        if shape_x < 0 or shape_x > self.crop['width']:
            in_panel = False
        if shape_y < 0 or shape_y > self.crop['height']:
            in_panel = False
        # Handle page offsets
        x = self.panel['x'] - self.page['x']
        y = self.panel['y'] - self.page['y']
        # scale and position on page within panel
        shape_x = (shape_x * self.scale) + x
        shape_y = (shape_y * self.scale) + y
        return {'x': shape_x, 'y': shape_y, 'inPanel': in_panel}

    def drawRectangle(self, shape):
        top_left = self.panelToPageCoords(shape['x'], shape['y'])

        # Don't draw if all corners are outside the panel
        top_right = self.panelToPageCoords(shape['x'] + shape['width'],
                                           shape['y'])
        bottom_left = self.panelToPageCoords(shape['x'],
                                             shape['y'] + shape['height'])
        bottom_right = self.panelToPageCoords(shape['x'] + shape['width'],
                                              shape['y'] + shape['height'])
        if (top_left['inPanel'] is False) and (
                top_right['inPanel'] is False) and (
                bottom_left['inPanel'] is False) and (
                bottom_right['inPanel'] is False):
            return

        width = shape['width'] * self.scale
        height = shape['height'] * self.scale
        x = top_left['x']
        y = self.page_height - top_left['y']    # - height

        rgb = self.getRGB(shape['strokeColor'])
        r = float(rgb[0])/255
        g = float(rgb[1])/255
        b = float(rgb[2])/255
        self.canvas.setStrokeColorRGB(r, g, b)
        stroke_width = shape['strokeWidth'] * self.scale
        self.canvas.setLineWidth(stroke_width)

        rotation = self.panel['rotation'] * -1
        if rotation != 0:
            self.canvas.saveState()
            self.canvas.translate(x, y)
            self.canvas.rotate(rotation)
            # top-left is now at 0, 0
            x = 0
            y = 0

        self.canvas.rect(x, y, width, height * -1, stroke=1)

        if rotation != 0:
            # Restore coordinates, rotation etc.
            self.canvas.restoreState()

    def drawLine(self, shape):
        start = self.panelToPageCoords(shape['x1'], shape['y1'])
        end = self.panelToPageCoords(shape['x2'], shape['y2'])
        x1 = start['x']
        y1 = self.page_height - start['y']
        x2 = end['x']
        y2 = self.page_height - end['y']
        # Don't draw if both points outside panel
        if (start['inPanel'] is False) and (end['inPanel'] is False):
            return

        rgb = self.getRGB(shape['strokeColor'])
        r = float(rgb[0])/255
        g = float(rgb[1])/255
        b = float(rgb[2])/255
        self.canvas.setStrokeColorRGB(r, g, b)
        stroke_width = shape['strokeWidth'] * self.scale
        self.canvas.setLineWidth(stroke_width)

        p = self.canvas.beginPath()
        p.moveTo(x1, y1)
        p.lineTo(x2, y2)
        self.canvas.drawPath(p, fill=1, stroke=1)

    def drawArrow(self, shape):
        start = self.panelToPageCoords(shape['x1'], shape['y1'])
        end = self.panelToPageCoords(shape['x2'], shape['y2'])
        x1 = start['x']
        y1 = self.page_height - start['y']
        x2 = end['x']
        y2 = self.page_height - end['y']
        stroke_width = shape['strokeWidth']
        # Don't draw if both points outside panel
        if (start['inPanel'] is False) and (end['inPanel'] is False):
            return

        rgb = self.getRGB(shape['strokeColor'])
        r = float(rgb[0])/255
        g = float(rgb[1])/255
        b = float(rgb[2])/255
        self.canvas.setStrokeColorRGB(r, g, b)
        self.canvas.setFillColorRGB(r, g, b)

        head_size = (stroke_width * 5) + 9
        head_size = head_size * self.scale
        dx = x2 - x1
        dy = y2 - y1

        stroke_width = stroke_width * self.scale
        self.canvas.setLineWidth(stroke_width)

        p = self.canvas.beginPath()
        f = -1
        if dy == 0:
            line_angle = radians(90)
            if dx < 0:
                f = 1
        else:
            line_angle = atan(dx / dy)
            if dy < 0:
                f = 1

        # Angle of arrow head is 0.8 radians (0.4 either side of line_angle)
        arrow_point1_x = x2 + (f * sin(line_angle - 0.4) * head_size)
        arrow_point1_y = y2 + (f * cos(line_angle - 0.4) * head_size)
        arrow_point2_x = x2 + (f * sin(line_angle + 0.4) * head_size)
        arrow_point2_y = y2 + (f * cos(line_angle + 0.4) * head_size)
        arrow_point_mid_x = x2 + (f * sin(line_angle) * head_size * 0.5)
        arrow_point_mid_y = y2 + (f * cos(line_angle) * head_size * 0.5)

        # Draw the line (at lineWidth)
        p.moveTo(x1, y1)
        p.lineTo(arrow_point_mid_x, arrow_point_mid_y)
        self.canvas.drawPath(p, fill=1, stroke=1)

        # Draw the arrow head (at lineWidth: 0)
        self.canvas.setLineWidth(0)
        p.moveTo(arrow_point1_x, arrow_point1_y)
        p.lineTo(arrow_point2_x, arrow_point2_y)
        p.lineTo(x2, y2)
        p.lineTo(arrow_point1_x, arrow_point1_y)
        self.canvas.drawPath(p, fill=1, stroke=1)

    def drawEllipse(self, shape):
        stroke_width = shape['strokeWidth'] * self.scale
        c = self.panelToPageCoords(shape['cx'], shape['cy'])
        cx = c['x']
        cy = self.page_height - c['y']
        rx = shape['rx'] * self.scale
        ry = shape['ry'] * self.scale
        rotation = (shape['rotation'] + self.panel['rotation']) * -1
        rgb = self.getRGB(shape['strokeColor'])
        r = float(rgb[0])/255
        g = float(rgb[1])/255
        b = float(rgb[2])/255
        self.canvas.setStrokeColorRGB(r, g, b)
        # Don't draw if centre outside panel
        if c['inPanel'] is False:
            return

        # For rotation, we reset our coordinates around cx, cy
        # so that rotation applies around cx, cy
        self.canvas.saveState()
        self.canvas.translate(cx, cy)
        self.canvas.rotate(rotation)
        # centre is now at 0, 0
        cx = 0
        cy = 0
        height = ry * 2
        width = rx * 2
        left = cx - rx
        bottom = cy - ry

        # Draw ellipse...
        p = self.canvas.beginPath()
        self.canvas.setLineWidth(stroke_width)
        p.ellipse(left, bottom, width, height)
        self.canvas.drawPath(p, stroke=1)

        # Restore coordinates, rotation etc.
        self.canvas.restoreState()


class ShapeToPilExport(object):
    """
    Class for drawing panel shapes onto a PIL image.
    We get a PIL image, the panel dict, and crop coordinates
    """

    def __init__(self, pil_img, panel, crop):

        self.pil_img = pil_img
        self.panel = panel
        # The crop region on the original image coordinates...
        self.crop = crop
        self.scale = pil_img.size[0] / crop['width']
        self.draw = ImageDraw.Draw(pil_img)

        if "shapes" in panel:
            for shape in panel["shapes"]:
                if shape['type'] == "Arrow":
                    self.drawArrow(shape)
                elif shape['type'] == "Line":
                    self.drawLine(shape)
                elif shape['type'] == "Rectangle":
                    self.drawRectangle(shape)
                elif shape['type'] == "Ellipse":
                    self.drawEllipse(shape)

    def getPanelCoords(self, shape_x, shape_y):
        """
        Convert coordinate from the image onto the panel.
        Handles zoom, offset & rotation of panel, rotating the
        x, y point around the centre of the cropped region
        and scaling appropriately
        """
        rotation = self.panel['rotation']
        # img coords: centre of rotation
        cx = self.crop['x'] + (self.crop['width']/2)
        cy = self.crop['y'] + (self.crop['height']/2)
        dx = cx - shape_x
        dy = cy - shape_y
        # distance of point from centre of rotation
        h = sqrt(dx * dx + dy * dy)
        # and the angle (avoid division by zero!)
        if dy == 0:
            angle1 = 90
        else:
            angle1 = atan(dx/dy)
            if (dy < 0):
                angle1 += radians(180)

        # Add the rotation to the angle and calculate new
        # opposite and adjacent lengths from centre of rotation
        angle2 = angle1 - radians(rotation)
        newo = sin(angle2) * h
        newa = cos(angle2) * h
        # to give correct x and y within cropped panel
        shape_x = cx - newo
        shape_y = cy - newa

        # convert to coords within crop region
        shape_x = (shape_x - self.crop['x']) * self.scale
        shape_y = (shape_y - self.crop['y']) * self.scale

        return {'x': shape_x, 'y': shape_y}

    def getRGB(self, color):
        # Convert from E.g. '#ff0000' to (255, 0, 0)
        red = int(color[1:3], 16)
        green = int(color[3:5], 16)
        blue = int(color[5:7], 16)
        return (red, green, blue)

    def drawArrow(self, shape):

        start = self.getPanelCoords(shape['x1'], shape['y1'])
        end = self.getPanelCoords(shape['x2'], shape['y2'])
        x1 = start['x']
        y1 = start['y']
        x2 = end['x']
        y2 = end['y']
        head_size = ((shape['strokeWidth'] * 5) + 9) * self.scale
        stroke_width = shape['strokeWidth'] * self.scale
        rgb = self.getRGB(shape['strokeColor'])

        # Do some trigonometry to get the line angle can calculate arrow points
        dx = x2 - x1
        dy = y2 - y1
        if dy == 0:
            line_angle = radians(90)
        else:
            line_angle = atan(dx / dy)
        f = -1
        if dy < 0:
            f = 1
        # Angle of arrow head is 0.8 radians (0.4 either side of line_angle)
        arrow_point1_x = x2 + (f * sin(line_angle - 0.4) * head_size)
        arrow_point1_y = y2 + (f * cos(line_angle - 0.4) * head_size)
        arrow_point2_x = x2 + (f * sin(line_angle + 0.4) * head_size)
        arrow_point2_y = y2 + (f * cos(line_angle + 0.4) * head_size)
        arrow_point_mid_x = x2 + (f * sin(line_angle) * head_size * 0.5)
        arrow_point_mid_y = y2 + (f * cos(line_angle) * head_size * 0.5)

        points = ((x2, y2),
                  (arrow_point1_x, arrow_point1_y),
                  (arrow_point2_x, arrow_point2_y),
                  (x2, y2)
                  )

        # Draw Line of arrow - to midpoint of head at full stroke width
        self.draw.line([(x1, y1), (arrow_point_mid_x, arrow_point_mid_y)],
                       fill=rgb, width=int(stroke_width))
        # Draw Arrow head, up to tip at x2, y2
        self.draw.polygon(points, fill=rgb, outline=rgb)

    def drawLine(self, shape):
        start = self.getPanelCoords(shape['x1'], shape['y1'])
        end = self.getPanelCoords(shape['x2'], shape['y2'])
        x1 = start['x']
        y1 = start['y']
        x2 = end['x']
        y2 = end['y']
        stroke_width = shape['strokeWidth'] * self.scale
        rgb = self.getRGB(shape['strokeColor'])

        self.draw.line([(x1, y1), (x2, y2)], fill=rgb, width=int(stroke_width))

    def drawRectangle(self, shape):
        # clockwise list of corner points on the OUTSIDE of thick line
        w = shape['strokeWidth']
        cx = shape['x'] + (shape['width']/2)
        cy = shape['y'] + (shape['height']/2)
        rotation = self.panel['rotation'] * -1

        # Centre of rect rotation in PIL image
        centre = self.getPanelCoords(cx, cy)
        cx = centre['x']
        cy = centre['y']
        scale_w = w * self.scale
        rgb = self.getRGB(shape['strokeColor'])

        # To support rotation, draw rect on temp canvas, rotate and paste
        width = int((shape['width'] + w) * self.scale)
        height = int((shape['height'] + w) * self.scale)
        temp_rect = Image.new('RGBA', (width, height), (255, 255, 255, 0))
        rect_draw = ImageDraw.Draw(temp_rect)

        # Draw outer rectangle, then remove inner rect with full opacity
        rect_draw.rectangle((0, 0, width, height), fill=rgb)
        rgba = (255, 255, 255, 0)
        rect_draw.rectangle((scale_w, scale_w, width-scale_w, height-scale_w),
                            fill=rgba)
        temp_rect = temp_rect.rotate(rotation, resample=Image.BICUBIC,
                                     expand=True)
        # Use rect as mask, so transparent part is not pasted
        paste_x = cx - (temp_rect.size[0]/2)
        paste_y = cy - (temp_rect.size[1]/2)
        self.pil_img.paste(temp_rect, (int(paste_x), int(paste_y)),
                           mask=temp_rect)

    def drawEllipse(self, shape):

        w = int(shape['strokeWidth'] * self.scale)
        ctr = self.getPanelCoords(shape['cx'], shape['cy'])
        cx = ctr['x']
        cy = ctr['y']
        rx = self.scale * shape['rx']
        ry = self.scale * shape['ry']
        rotation = (shape['rotation'] + self.panel['rotation']) * -1
        rgb = self.getRGB(shape['strokeColor'])

        width = int((rx * 2) + w)
        height = int((ry * 2) + w)
        temp_ellipse = Image.new('RGBA', (width + 1, height + 1),
                                 (255, 255, 255, 0))
        ellipse_draw = ImageDraw.Draw(temp_ellipse)
        # Draw outer ellipse, then remove inner ellipse with full opacity
        ellipse_draw.ellipse((0, 0, width, height), fill=rgb)
        rgba = (255, 255, 255, 0)
        ellipse_draw.ellipse((w, w, width - w, height - w), fill=rgba)
        temp_ellipse = temp_ellipse.rotate(rotation, resample=Image.BICUBIC,
                                           expand=True)
        # Use ellipse as mask, so transparent part is not pasted
        paste_x = cx - (temp_ellipse.size[0]/2)
        paste_y = cy - (temp_ellipse.size[1]/2)
        self.pilImg.paste(temp_ellipse, (int(paste_x), int(paste_y)),
                          mask=temp_ellipse)


class FigureExport(object):
    """
    Super class for exporting various figures, such as PDF or TIFF etc.
    """

    def __init__(self, conn, script_params, export_images=False):

        self.conn = conn
        self.script_params = script_params
        self.export_images = export_images

        self.ns = "omero.web.figure.pdf"
        self.mimetype = "application/pdf"

        figure_json_string = script_params['Figure_JSON']
        # Since unicode can't be wrapped by rstring
        figure_json_string = figure_json_string.decode('utf8')
        self.figure_json = json.loads(figure_json_string)

        n = datetime.now()
        # time-stamp name by default: Figure_2013-10-29_22-43-53.pdf
        self.figure_name = u"Figure_%s-%s-%s_%s-%s-%s" % (
            n.year, n.month, n.day, n.hour, n.minute, n.second)
        if 'figureName' in self.figure_json:
            self.figure_name = self.figure_json['figureName']

        # get Figure width & height...
        self.page_width = self.figure_json['paper_width']
        self.page_height = self.figure_json['paper_height']

    def getZipName(self):

        # file names can't include unicode characters
        name = unicodedata.normalize(
            'NFKD', self.figureName).encode('ascii', 'ignore')
        # in case we have path/to/name.pdf, just use name.pdf
        name = path.basename(name)
        # Remove commas: causes problems 'duplicate headers' in file download
        name = name.replace(",", ".")
        return "%s.zip" % name

    def getFigureFileName(self):
        """
        For PDF export we will only create a single figure file, but
        for TIFF export we may have several pages, so we need unique names
        for each to avoid overwriting.
        This method supports both, simply using different extension
        (pdf/tiff) for each.
        """

        # Extension is pdf or tiff
        fext = self.getFigureFileExt()

        # file names can't include unicode characters
        name = unicodedata.normalize(
            'NFKD', self.figureName).encode('ascii', 'ignore')
        # in case we have path/to/name, just use name
        name = path.basename(name)

        # if ends with E.g. .pdf, remove extension
        if name.endswith("." + fext):
            name = name[0: -len("." + fext)]

        # Name with extension and folder
        full_name = "%s.%s" % (name, fext)
        # Remove commas: causes problems 'duplicate headers' in file download
        full_name = full_name.replace(",", ".")

        index = 1
        if fext == "tiff" and self.page_count > 1:
            full_name = "%s_page_%02d.%s" % (name, index, fext)
        if self.zip_folder_name is not None:
            full_name = os.path.join(self.zip_folder_name, full_name)

        while(os.path.exists(full_name)):
            index += 1
            full_name = "%s_page_%02d.%s" % (name, index, fext)
            if self.zip_folder_name is not None:
                full_name = os.path.join(self.zip_folder_name, full_name)

        # Handy to know what the last created file is:
        self.figure_file_name = full_name

        print "getFigureFileName()", full_name
        return full_name

    def buildFigure(self):
        """
        The main building of the figure happens here, independently of format.
        We set up directories as needed, call createFigure() to create
        the PDF or TIFF then iterate through figure pages, adding panels
        for each page.
        Then we add an info page and create a zip of everything if needed.
        Finally the created file or zip is uploaded to OMERO and attached
        as a file annotation to all the images in the figure.
        """

        # test to see if we've got multiple pages
        page_count = ('page_count' in self.figure_json and
                      self.figure_json['page_count'] or 1)
        self.page_count = int(page_count)
        paper_spacing = ('paper_spacing' in self.figure_json and
                         self.figure_json['paper_spacing'] or 50)
        page_col_count = ('page_col_count' in self.figure_json and
                          self.figure_json['page_col_count'] or 1)

        # Create a zip if we have multiple TIFF pages or we're exporting Images
        export_option = self.script_params['Export_Option']
        create_zip = False
        if self.exportImages:
            create_zip = True
        if (self.page_count > 1) and (export_option.startswith("TIFF")):
            create_zip = True

        # somewhere to put PDF and images
        self.zip_folder_name = None
        if create_zip:
            self.zip_folder_name = "figure"
            curr_dir = os.getcwd()
            zip_dir = os.path.join(curr_dir, self.zip_folder_name)
            os.mkdir(zip_dir)
            if self.export_images:
                for d in (ORIGINAL_DIR, RESAMPLED_DIR, FINAL_DIR):
                    img_dir = os.path.join(zip_dir, d)
                    os.mkdir(img_dir)
                self.addReadMeFile()

        # Create the figure file(s)
        self.createFigure()

        panels_json = self.figure_json['panels']
        image_ids = set()

        group_id = None
        # We get our group from the first image
        id1 = panels_json[0]['imageId']
        group_id = self.conn.getObject("Image", id1).getDetails().group.id.val

        # For each page, add panels...
        col = 0
        row = 0
        for p in range(self.page_count):
            print ("\n------------------------- PAGE ", p + 1,
                   "--------------------------")
            px = col * (self.page_width + paper_spacing)
            py = row * (self.page_height + paper_spacing)
            page = {'x': px, 'y': py}

            # if export_option == "TIFF":
            #     add_panels_to_tiff(conn, tiffFigure, panels_json, imageIds,
            #     page)
            # elif export_option == "PDF":
            self.add_panels_to_page(panels_json, image_ids, page)

            # complete page and save
            self.savePage()

            col = col + 1
            if col >= page_col_count:
                col = 0
                row = row + 1

        # Add thumbnails and links page
        self.addInfoPage(panels_json)

        # Saves the completed  figure file
        self.saveFigure()

        # PDF will get created in this group
        if group_id is None:
            group_id = self.conn.getEventContext().groupId
        self.conn.SERVICE_OPTS.setOmeroGroup(group_id)

        output_file = self.figure_file_name
        ns = self.ns
        mimetype = self.mimetype

        if self.zip_folder_name is not None:
            zip_name = self.getZipName()
            # Recursively zip everything up
            compress(zip_name, self.zip_folder_name)

            output_file = zip_name
            ns = "omero.web.figure.zip"
            mimetype = "application/zip"

        file_ann = self.conn.createFileAnnfromLocalFile(
            output_file,
            mimetype=mimetype,
            ns=ns)

        links = []
        for iid in list(image_ids):
            print "linking to", iid
            link = ImageAnnotationLinkI()
            link.parent = ImageI(iid, False)
            link.child = file_ann._obj
            links.append(link)
        if len(links) > 0:
            # Don't want to fail at this point due to strange permissions combo
            try:
                links = self.conn.getUpdateService().saveAndReturnArray(
                    links, self.conn.SERVICE_OPTS)
            except:
                print ("Failed to attach figure: %s to images %s"
                       % (file_ann, image_ids))

        return file_ann

    def applyRdefs(self, image, channels):
        """ Apply the channel levels and colors to the image """
        c_idxs = []
        windows = []
        colors = []

        # OMERO.figure doesn't support greyscale rendering
        image.setColorRenderingModel()

        for i, c in enumerate(channels):
            if c['active']:
                c_idxs.append(i+1)
                windows.append([c['window']['start'], c['window']['end']])
                colors.append(c['color'])

        print "setActiveChannels", c_idxs, windows, colors
        image.setActiveChannels(c_idxs, windows, colors)

    def getCropRegion(self, panel):
        """
        Gets the width and height in points/pixels for a panel in the
        figure. This is at the 'original' figure / PDF coordinates
        (E.g. before scaling for TIFF export)
        """
        zoom = float(panel['zoom'])
        frame_w = panel['width']
        frame_h = panel['height']
        dx = panel['dx']
        dy = panel['dy']
        orig_w = panel['orig_width']
        orig_h = panel['orig_height']

        # need tile_x, tile_y, tile_w, tile_h

        tile_w = orig_w / (zoom/100)
        tile_h = orig_h / (zoom/100)

        print 'zoom', zoom
        print 'frame_w', frame_w, 'frame_h', frame_h, 'orig', orig_w, orig_h
        print "Initial tile w, h", tile_w, tile_h

        orig_ratio = float(orig_w) / orig_h
        wh = float(frame_w) / frame_h

        if abs(orig_ratio - wh) > 0.01:
            # if viewport is wider than orig...
            if (orig_ratio < wh):
                print "viewport wider"
                tile_h = tile_w / wh
            else:
                print "viewport longer"
                tile_w = tile_h * wh

        print 'dx', dx, '(orig_w - tile_w)/2', (orig_w - tile_w)/2
        cropx = ((orig_w - tile_w)/2) - dx
        cropy = ((orig_h - tile_h)/2) - dy

        print 'tile_w', tile_w, 'tile_h', tile_h
        return {'x': cropx, 'y': cropy, 'width': tile_w, 'height': tile_h}

    def get_time_label_text(self, delta_t, format):
        """ Gets the text for 'live' time-stamp labels """
        if format == "secs":
            text = "%s secs" % delta_t
        elif format == "mins":
            text = "%s mins" % int(round(float(delta_t) / 60))
        elif format == "hrs:mins":
            h = (delta_t / 3600)
            m = int(round((float(delta_t) % 3600) / 60))
            text = "%s:%02d" % (h, m)
        elif format == "hrs:mins:secs":
            h = (delta_t / 3600)
            m = (delta_t % 3600) / 60
            s = delta_t % 60
            text = "%s:%02d:%02d" % (h, m, s)
        return text

    def addROIs(self, panel, page):
        """
        Add any Shapes
        """
        if "shapes" not in panel:
            return

        crop = self.getCropRegion(panel)
        ShapeToPdfExport(self.figureCanvas, panel, page, crop, self.page_height)

    def drawLabels(self, panel, page):
        """
        Add the panel labels to the page.
        Here we calculate the position of labels but delegate
        to self.drawText() to actually place the labels on PDF/TIFF
        """
        labels = panel['labels']
        x = panel['x']
        y = panel['y']
        width = panel['width']
        height = panel['height']

        # Handle page offsets
        x = x - page['x']
        y = y - page['y']

        spacer = 5

        # group by 'position':
        positions = {'top': [], 'bottom': [], 'left': [],
                     'leftvert': [], 'right': [],
                     'topleft': [], 'topright': [],
                     'bottomleft': [], 'bottomright': []}

        print "sorting labels..."
        for l in labels:
            if 'text' not in l:
                print "NO text", 'time' in l, 'deltaT', 'deltaT' in panel
                print panel['theT'], len(panel['deltaT']),
                print panel['theT'] < len(panel['deltaT'])
                if 'deltaT' in panel and panel['theT'] < len(panel['deltaT']):
                    the_t = panel['theT']
                    print 'theT', the_t
                    d_t = panel['deltaT'][the_t]
                    print 'dT', d_t
                    text = self.get_time_label_text(d_t, l['time'])
                    print 'text', text
                    l['text'] = text
                else:
                    continue

            print l
            pos = l['position']
            l['size'] = int(l['size'])   # make sure 'size' is number
            if pos in positions:
                positions[pos].append(l)

        def drawLab(label, lx, ly, align='left'):
            label_h = label['size']
            color = label['color']
            red = int(color[0:2], 16)
            green = int(color[2:4], 16)
            blue = int(color[4:6], 16)
            fontsize = label['size']
            rgb = (red, green, blue)
            text = label['text']

            self.drawText(text, lx, ly, fontsize, rgb, align=align)
            return label_h

        # Render each position:
        for key, labels in positions.items():
            if key == 'topleft':
                lx = x + spacer
                ly = y + spacer
                for l in labels:
                    label_h = drawLab(l, lx, ly)
                    ly += label_h + spacer
            elif key == 'topright':
                lx = x + width - spacer
                ly = y + spacer
                for l in labels:
                    label_h = drawLab(l, lx, ly, align='right')
                    ly += label_h + spacer
            elif key == 'bottomleft':
                lx = x + spacer
                ly = y + height
                labels.reverse()  # last item goes bottom
                for l in labels:
                    ly = ly - l['size'] - spacer
                    drawLab(l, lx, ly)
            elif key == 'bottomright':
                lx = x + width - spacer
                ly = y + height
                labels.reverse()  # last item goes bottom
                for l in labels:
                    ly = ly - l['size'] - spacer
                    drawLab(l, lx, ly, align='right')
            elif key == 'top':
                lx = x + (width/2)
                ly = y
                labels.reverse()
                for l in labels:
                    ly = ly - l['size'] - spacer
                    drawLab(l, lx, ly, align='center')
            elif key == 'bottom':
                lx = x + (width/2)
                ly = y + height + spacer
                for l in labels:
                    label_h = drawLab(l, lx, ly, align='center')
                    ly += label_h + spacer
            elif key == 'left':
                lx = x - spacer
                sizes = [l['size'] for l in labels]
                total_h = sum(sizes) + spacer * (len(labels)-1)
                ly = y + (height-total_h)/2
                for l in labels:
                    label_h = drawLab(l, lx, ly, align='right')
                    ly += label_h + spacer
            elif key == 'right':
                lx = x + width + spacer
                sizes = [l['size'] for l in labels]
                total_h = sum(sizes) + spacer * (len(labels)-1)
                ly = y + (height-total_h)/2
                for l in labels:
                    label_h = drawLab(l, lx, ly)
                    ly += label_h + spacer
            elif key == 'leftvert':
                lx = x - spacer
                ly = y + (height/2)
                labels.reverse()
                for l in labels:
                    lx = lx - l['size'] - spacer
                    drawLab(l, lx, ly, align='vertical')

    def drawScalebar(self, panel, region_width, page):
        """
        Add the scalebar to the page.
        Here we calculate the position of scalebar but delegate
        to self.drawLine() and self.drawText() to actually place
        the scalebar and label on PDF/TIFF
        """
        x = panel['x']
        y = panel['y']
        width = panel['width']
        height = panel['height']

        # Handle page offsets
        x = x - page['x']
        y = y - page['y']

        if not ('scalebar' in panel and 'show' in panel['scalebar'] and
                panel['scalebar']['show']):
            return

        if not ('pixel_size_x' in panel and panel['pixel_size_x'] > 0):
            print "Can't show scalebar - pixel_size_x is not defined for panel"
            return

        sb = panel['scalebar']

        spacer = 0.05 * max(height, width)

        color = sb['color']
        red = int(color[0:2], 16)
        green = int(color[2:4], 16)
        blue = int(color[4:6], 16)

        position = 'position' in sb and sb['position'] or 'bottomright'
        print 'scalebar.position', position
        align = 'left'

        if position == 'topleft':
            lx = x + spacer
            ly = y + spacer
        elif position == 'topright':
            lx = x + width - spacer
            ly = y + spacer
            align = "right"
        elif position == 'bottomleft':
            lx = x + spacer
            ly = y + height - spacer
        elif position == 'bottomright':
            lx = x + width - spacer
            ly = y + height - spacer
            align = "right"

        print "Adding Scalebar of %s microns." % sb['length'],
        print "Pixel size is %s microns" % panel['pixel_size_x']
        pixels_length = sb['length'] / panel['pixel_size_x']
        scale_to_canvas = panel['width'] / float(region_width)
        canvas_length = pixels_length * scale_to_canvas
        print 'Scalebar length (panel pixels):', pixels_length
        print 'Scale by %s to page ' \
              'coordinate length: %s' % (scale_to_canvas, canvas_length)

        if align == 'left':
            lx_end = lx + canvas_length
        else:
            lx_end = lx - canvas_length

        self.drawLine(lx, ly, lx_end, ly, 3, (red, green, blue))

        if 'show_label' in sb and sb['show_label']:
            # c = self.figureCanvas
            symbol = u"\u00B5m"
            if 'pixel_size_x_symbol' in panel:
                symbol = panel['pixel_size_x_symbol']
            label = "%s %s" % (sb['length'], symbol)
            font_size = 10
            try:
                font_size = int(sb['font_size'])
            except:
                pass

            # For 'bottom' scalebar, put label above
            if 'bottom' in position:
                ly = ly - font_size
            else:
                ly = ly + 5

            self.drawText(
                label, (lx + lx_end)/2, ly, font_size, (red, green, blue),
                align="center")

    def getPanelImage(self, image, panel, orig_name=None):
        """
        Gets the rendered image from OMERO, then crops & rotates as needed.
        Optionally saving original and cropped images as TIFFs.
        Returns image as PIL image.
        """
        z = panel['theZ']
        t = panel['theT']

        if 'z_projection' in panel and panel['z_projection']:
            if 'z_start' in panel and 'z_end' in panel:
                print "Z_projection:", panel['z_start'], panel['z_end']
                image.setProjection('intmax')
                image.setProjectionRange(panel['z_start'], panel['z_end'])

        pil_img = image.renderImage(z, t, compression=1.0)

        # We don't need to render again, so we can close rendering engine.
        image._re.close()

        if orig_name is not None:
            pil_img.save(orig_name)

        # Need to crop around centre before rotating...
        size_x = image.getSizeX()
        size_y = image.getSizeY()
        cx = size_x/2
        cy = size_y/2
        dx = panel['dx']
        dy = panel['dy']

        cx += dx
        cy += dy

        crop_left = 0
        crop_top = 0
        crop_right = size_x
        crop_bottom = size_y

        # We 'inverse crop' to make the image bigger, centred by dx, dy.
        # This is really only needed for rotation, but also gets us centered...
        if dx > 0:
            crop_left = int(dx * -2)
        else:
            crop_right = crop_right - int(dx * 2)
        if dy > 0:
            crop_top = int(dy * -2)
        else:
            crop_bottom = crop_bottom - int(dy * 2)

        # convert to RGBA so we can control background after crop/rotate...
        # See http://stackoverflow.com/questions/5252170/
        mde = pil_img.mode
        pil_img = pil_img.convert('RGBA')
        pil_img = pil_img.crop((crop_left, crop_top, crop_right, crop_bottom))

        # Optional rotation
        if ('rotation' in panel and panel['rotation'] > 0):
            rotation = -int(panel['rotation'])
            pil_img = pil_img.rotate(rotation, Image.BICUBIC)

        # Final crop to size
        panel_size = self.getCropRegion(panel)

        w, h = pil_img.size
        tile_w = panel_size['width']
        tile_h = panel_size['height']
        crop_left = int((w - tile_w) / 2)
        crop_top = int((h - tile_h) / 2)
        crop_right = w - crop_left
        crop_bottom = h - crop_top

        pil_img = pil_img.crop((crop_left, crop_top, crop_right, crop_bottom))

        # ...paste image with transparent blank areas onto white background
        fff = Image.new('RGBA', pil_img.size, (255, 255, 255, 255))
        out = Image.composite(pil_img, fff, pil_img)
        # and convert back to original mode
        out.convert(mde)

        return out

    def drawPanel(self, panel, page, idx):
        """
        Gets the image from OMERO, processes (and saves) it then
        calls self.pasteImage() to add it to PDF or TIFF figure.
        """
        image_id = panel['imageId']
        channels = panel['channels']
        x = panel['x']
        y = panel['y']

        # Handle page offsets
        x = x - page['x']
        y = y - page['y']

        image = self.conn.getObject("Image", image_id)
        self.applyRdefs(image, channels)

        # create name to save image
        original_name = image.getName()
        img_name = os.path.basename(original_name)
        img_name = "%s_%s.tiff" % (idx, img_name)

        # get cropped image (saving original)
        orig_name = None
        if self.export_images:
            orig_name = os.path.join(
                self.zip_folder_name, ORIGINAL_DIR, img_name)
            print "Saving original to: ", orig_name
        pil_img = self.getPanelImage(image, panel, orig_name)

        # for PDF export, we might have a target dpi
        dpi = 'export_dpi' in panel and panel['export_dpi'] or None

        # Paste the panel to PDF or TIFF image
        self.pasteImage(pil_img, img_name, panel, page, dpi)

        return image, pil_img

    def getThumbnail(self, image_id):
        """ Saves thumb as local jpg and returns name """

        conn = self.conn
        image = conn.getObject("Image", image_id)
        thumb_data = image.getThumbnail(size=(96, 96))
        i = StringIO(thumb_data)
        pil_img = Image.open(i)
        temp_name = str(image_id) + "thumb.jpg"
        pil_img.save(temp_name)
        return temp_name

    def addParaWithThumb(self, text, page_y, style, thumb_src=None):
        """ Adds paragraph text to point on PDF info page """

        c = self.figureCanvas
        aw = self.page_width - (inch * 2)
        maxh = self.page_height - inch
        spacer = 10
        imgw = imgh = 25
        # Some html from markdown may not be compatible
        # with adding to PDF.
        try:
            para = Paragraph(text, style)
        except ValueError:
            print "Couldn't add paragraph to PDF:"
            print text
            text = "[Failed to format paragraph - not shown]"
            para = Paragraph(text, style)
        w, h = para.wrap(aw, page_y)   # find required space
        if thumb_src is not None:
            parah = max(h, imgh)
        else:
            parah = h
        # If there's not enough space, start a new page
        if parah > (page_y - inch):
            print "new page"
            c.save()
            page_y = maxh    # reset to top of new page
        indent = inch
        if thumb_src is not None:
            c.drawImage(thumb_src, inch, page_y - imgh, imgw, imgh)
            indent = indent + imgw + spacer
        para.drawOn(c, indent, page_y - h)
        return page_y - parah - spacer  # reduce the available height

    def addReadMeFile(self):
        """ Add a simple text file into the zip to explain what's there """
        read_me_path = os.path.join(self.zip_folder_name, "README.txt")
        f = open(read_me_path, 'w')
        try:
            f.write(README_TXT)
        finally:
            f.close()

    def addInfoPage(self, panels_json):
        """Generates a PDF info page with figure title, links to images etc"""
        script_params = self.script_params
        figure_name = self.figure_name
        base_url = None
        if 'Webclient_URI' in script_params:
            base_url = script_params['Webclient_URI']
        page_height = self.page_height
        avail_height = page_height-2*inch
        print 'availHeight', avail_height

        # Need to sort panels from top (left) -> bottom of Figure
        panels_json.sort(key=lambda x: int(x['y']) + x['y'] * 0.01)

        img_ids = set()
        styles = getSampleStyleSheet()
        style_n = styles['Normal']
        style_h = styles['Heading1']
        style_h3 = styles['Heading3']

        scalebars = []
        maxh = page_height - inch

        # Start adding at the top, update page_y as we add paragraphs
        page_y = maxh
        page_y = self.addParaWithThumb(figure_name, page_y, style=style_h)

        if "Figure_URI" in script_params:
            file_url = script_params["Figure_URI"]
            print "Figure URL", file_url
            figure_link = ("Link to Figure: <a href='%s' color='blue'>%s</a>"
                           % (file_url, file_url))
            page_y = self.addParaWithThumb(figure_link, page_y, style=style_n)

        # Add Figure Legend
        if ('legend' in self.figure_json and
                len(self.figure_json['legend']) > 0):
            page_y = self.addParaWithThumb("Legend:", page_y, style=style_h3)
            print "\n--- Adding Figure Legend ---"
            legend = self.figure_json['legend']
            if markdown_imported:
                # convert markdown to html
                legend = markdown.markdown(legend)
                # insert 'blue' style into any links
                legend = legend.replace("<a href", "<a color='blue' href")
                # Add paragraphs separately
                para_lines = legend.split("<p>")
                for p in para_lines:
                    p = "<p>" + p
                    page_y = self.addParaWithThumb(p, page_y, style=style_n)
            else:
                print ("Markdown not imported. See"
                       " https://pythonhosted.org/Markdown/install.html")
                page_y = self.addParaWithThumb(legend, page_y, style=style_n)

        page_y = self.addParaWithThumb(
            "Figure contains the following images:", page_y, style=style_h3)

        # Go through sorted panels, adding paragraph for each unique image
        for p in panels_json:
            iid = p['imageId']
            # list unique scalebar lengths
            if 'scalebar' in p:
                sb_length = p['scalebar']['length']
                symbol = u"\u00B5m"
                if 'pixel_size_x_symbol' in p:
                    symbol = p['pixel_size_x_symbol']
                scalebars.append("%s %s" % (sb_length, symbol))
            if iid in img_ids:
                continue    # ignore images we've already handled
            img_ids.add(iid)
            thumb_src = self.getThumbnail(iid)
            # thumb = "<img src='%s' width='%s' height='%s' " \
            #         "valign='middle' />" % (thumbSrc, thumbSize, thumbSize)
            lines = []
            lines.append(p['name'])
            img_url = "%s?show=image-%s" % (base_url, iid)
            lines.append(
                "<a href='%s' color='blue'>%s</a>" % (img_url, img_url))
            # addPara([" ".join(line)])
            line = " ".join(lines)
            page_y = self.addParaWithThumb(
                line, page_y, style=style_n, thumbSrc=thumb_src)

        if len(scalebars) > 0:
            scalebars = list(set(scalebars))
            page_y = self.addParaWithThumb("Scalebars:", page_y,
                                           style=style_h3)
            page_y = self.addParaWithThumb(
                "Scalebar Lengths: %s" % ", ".join(scalebars),
                page_y, style=style_n)

    def panel_is_on_page(self, panel, page):
        """ Return true if panel overlaps with this page """
        px = panel['x']
        px2 = px + panel['width']
        py = panel['y']
        py2 = py + panel['height']
        cx = page['x']
        cx2 = cx + self.page_width
        cy = page['y']
        cy2 = cy + self.page_height
        # overlap needs overlap on x-axis...
        return px < cx2 and cx < px2 and py < cy2 and cy < py2

    def add_panels_to_page(self, panels_json, image_ids, page):
        """ Add panels that are within the bounds of this page """
        for i, panel in enumerate(panels_json):

            if not self.panel_is_on_page(panel, page):
                print 'Panel', panel['imageId'], 'not on page...'
                continue

            print "\n-------------------------------- "
            image_id = panel['imageId']
            print "Adding PANEL - Image ID:", image_id
            # drawPanel() creates PIL image then applies it to the page.
            # For TIFF export, drawPanel() also adds shapes to the
            # PIL image before pasting onto the page...
            image, pil_img = self.drawPanel(panel, page, i)
            if image.canAnnotate():
                image_ids.add(image_id)
            # ... but for PDF we have to add shapes to the whole PDF page
            self.addROIs(panel, page)       # This does nothing for TIFF export

            # Finally, add scale bar and labels to the page
            self.drawScalebar(panel, pil_img.size[0], page)
            self.drawLabels(panel, page)
            print ""

    def getFigureFileExt(self):
        return "pdf"

    def createFigure(self):
        """
        Creates a PDF figure. This is overwritten by ExportTiff subclass.
        """
        if not reportlab_installed:
            raise ImportError(
                "Need to install https://bitbucket.org/rptlab/reportlab")
        name = self.getFigureFileName()
        self.figure_canvas = canvas.Canvas(
            name, pagesize=(self.page_width, self.page_height))

    def savePage(self):
        """ Called on completion of each page. Saves page of PDF """
        self.figure_canvas.showPage()

    def saveFigure(self):
        """ Completes PDF figure (or info-page PDF for TIFF export) """
        self.figure_canvas.save()

    def drawText(self, text, x, y, fontsize, rgb, align="center"):
        """ Adds text to PDF. Overwritten for TIFF below """
        ly = y + fontsize
        ly = self.page_height - ly + 5
        c = self.figure_canvas

        red, green, blue = rgb
        red = float(red)/255
        green = float(green)/255
        blue = float(blue)/255
        c.setFont("Helvetica", fontsize)
        c.setFillColorRGB(red, green, blue)
        if (align == "center"):
            c.drawCentredString(x, ly, text)
        elif (align == "right"):
            c.drawRightString(x, ly, text)
        elif (align == "left"):
            c.drawString(x, ly, text)
        elif align == 'vertical':
            c.rotate(90)
            c.drawCentredString(self.page_height - y, -(x + fontsize), text)
            c.rotate(-90)

    def drawLine(self, x, y, x2, y2, width, rgb):
        """ Adds line to PDF. Overwritten for TIFF below """
        red, green, blue = rgb
        red = float(red)/255
        green = float(green)/255
        blue = float(blue)/255

        y = self.page_height - y
        y2 = self.page_height - y2
        c = self.figure_canvas
        c.setLineWidth(width)
        c.setStrokeColorRGB(red, green, blue)
        c.line(x, y, x2, y2,)

    def pasteImage(self, pil_img, img_name, panel, page, dpi):
        """ Adds the PIL image to the PDF figure. Overwritten for TIFFs """

        x = panel['x']
        y = panel['y']
        width = panel['width']
        height = panel['height']
        # Handle page offsets
        x = x - page['x']
        y = y - page['y']

        if dpi is not None:
            print "Resample panel to %s dpi..." % dpi
            # E.g. target is 300 dpi and width & height is '72 dpi'
            # so we need image to be width * dpi/72 pixels
            target_w = (width * dpi) / 72
            curr_w, curr_h = pil_img.size
            dpi_scale = float(target_w) / curr_w
            target_h = dpi_scale * curr_h
            target_w = int(round(target_w))
            target_h = int(round(target_h))
            print "    curr_w, curr_h", curr_w, curr_h
            if target_w > curr_w:
                if self.export_images:
                    # Save image BEFORE resampling
                    rs_name = os.path.join(
                        self.zip_folder_name, RESAMPLED_DIR, img_name)
                    print "Saving pre_resampled to: ", rs_name
                    pil_img.save(rs_name)
                print "    Resample to target_w, target_h", target_w, target_h
                pil_img = pil_img.resize((target_w, target_h), Image.BICUBIC)
            else:
                print "    Already over %s dpi" % dpi

        # in the folder to zip
        if self.zip_folder_name is not None:
            img_name = os.path.join(self.zip_folder_name, FINAL_DIR, img_name)

        # Save Image to file, then bring into PDF
        pil_img.save(img_name)
        # Since coordinate system is 'bottom-up', convert from 'top-down'
        y = self.page_height - height - y
        self.figure_canvas.drawImage(img_name, x, y, width, height)


class TiffExport(FigureExport):
    """
    Subclass to handle export of Figure as TIFFs, 1 per page.
    We only need to overwrite methods that actually put content on
    the TIFF instead of PDF.
    """

    def __init__(self, conn, script_params, export_images=None):

        super(TiffExport, self).__init__(conn, script_params, export_images)

        from omero.gateway import THISPATH
        self.GATEWAYPATH = THISPATH
        self.font_path = os.path.join(THISPATH, "pilfonts", "FreeSans.ttf")

        self.ns = "omero.web.figure.tiff"
        self.mimetype = "image/tiff"

    def addROIs(self, panel, page):
        """ TIFF export doesn't add ROIs to page (does it to panel)"""
        pass

    def getFont(self, fontsize):
        """ Try to load font from known location in OMERO """
        try:
            font = ImageFont.truetype(self.font_path, fontsize)
        except:
            font = ImageFont.load(
                '%s/pilfonts/B%0.2d.pil' % (self.GATEWAYPATH, 24))
        return font

    def scaleCoords(self, coord):
        """
        Origianl figure coordinates assume 72 dpi figure, but we want to
        export at 300 dpi, so everything needs scaling accordingly
        """
        return (coord * 300)/72

    def getFigureFileExt(self):
        return "tiff"

    def createFigure(self):
        """
        Creates a new PIL image ready to receive panels, labels etc.
        This is created for each page in the figure.
        """
        tiff_width = self.scaleCoords(self.page_width)
        tiff_height = self.scaleCoords(self.page_height)
        print "TIFF: width, height", tiff_width, tiff_height
        self.tiffFigure = Image.new(
            "RGBA", (tiff_width, tiff_height), (255, 255, 255))

    def pasteImage(self, pil_img, img_name, panel, page, dpi=None):
        """ Add the PIL image to the current figure page """

        x = panel['x']
        y = panel['y']
        width = panel['width']
        height = panel['height']

        # Handle page offsets
        x = x - page['x']
        y = y - page['y']

        print "pasteImage: x, y, width, height", x, y, width, height
        x = self.scaleCoords(x)
        y = self.scaleCoords(y)
        width = self.scaleCoords(width)
        height = self.scaleCoords(height)
        print "scaleCoords: x, y, width, height", x, y, width, height

        x = int(round(x))
        y = int(round(y))
        width = int(round(width))
        height = int(round(height))

        # Save image BEFORE resampling
        if self.exportImages:
            rs_name = os.path.join(self.zip_folder_name, RESAMPLED_DIR,
                                   img_name)
            print "Saving pre_resampled to: ", rs_name
            pil_img.save(rs_name)

        # Resize to our target size to match DPI of figure
        print "resize to: x, y, width, height", x, y, width, height
        pil_img = pil_img.resize((width, height), Image.BICUBIC)

        if self.exportImages:
            img_name = os.path.join(self.zip_folder_name, FINAL_DIR, img_name)
            pil_img.save(img_name)

        # Now at full figure resolution - Good time to add shapes...
        crop = self.getCropRegion(panel)
        ShapeToPilExport(pil_img, panel, crop)

        width, height = pil_img.size
        box = (x, y, x + width, y + height)
        self.tiffFigure.paste(pil_img, box)

    def drawLine(self, x, y, x2, y2, width, rgb):
        """ Draw line on the current figure page """
        draw = ImageDraw.Draw(self.tiffFigure)

        x = self.scaleCoords(x)
        y = self.scaleCoords(y)
        x2 = self.scaleCoords(x2)
        y2 = self.scaleCoords(y2)
        width = self.scaleCoords(width)

        print "drawLine - TIFF...", x, y, x2, y2

        for l in range(width):
            draw.line([(x, y), (x2, y2)], fill=rgb)
            y += 1
            y2 += 1

    def drawText(self, text, x, y, fontsize, rgb, align="center"):
        """ Add text to the current figure page """
        x = self.scaleCoords(x)
        fontsize = self.scaleCoords(fontsize)

        font = self.getFont(fontsize)
        txt_w, txt_h = font.getsize(text)

        if align == "vertical":
            # write text on temp image (transparent)
            y = self.scaleCoords(y)
            x = int(round(x))
            y = int(round(y))
            temp_label = Image.new('RGBA', (txt_w, txt_h), (255, 255, 255, 0))
            textdraw = ImageDraw.Draw(temp_label)
            textdraw.text((0, 0), text, font=font, fill=rgb)
            w = temp_label.rotate(90, expand=True)
            # Use label as mask, so transparent part is not pasted
            y = y - (w.size[1]/2)
            self.tiffFigure.paste(w, (x, y), mask=w)
        else:
            y = y - 5       # seems to help, but would be nice to fix this!
            y = self.scaleCoords(y)
            textdraw = ImageDraw.Draw(self.tiffFigure)
            if align == "center":
                x = x - (txt_w / 2)
            elif align == "right":
                x = x - txt_w
            textdraw.text((x, y), text, font=font, fill=rgb)

    def savePage(self):
        """
        Save the current PIL image page as a TIFF and start a new
        PIL image for the next page
        """
        self.figureFileName = self.getFigureFileName()

        self.tiffFigure.save(self.figureFileName)

        # Create a new blank tiffFigure for subsequent pages
        self.createFigure()

    def addInfoPage(self, panels_json):
        """
        Since we need a PDF for the info page, we create one first,
        then call superclass addInfoPage
        """
        # We allow TIFF figure export without reportlab (no Info page)
        if not reportlab_installed:
            return

        full_name = "info_page.pdf"
        if self.zip_folder_name is not None:
            full_name = os.path.join(self.zip_folder_name, full_name)
        self.figure_canvas = canvas.Canvas(
            full_name, pagesize=(self.page_width, self.page_height))

        # Superclass method will call addParaWithThumb(),
        # to add lines to self.infoLines
        super(TiffExport, self).addInfoPage(panels_json)

    def saveFigure(self):
        """ Completes PDF figure (or info-page PDF for TIFF export) """
        # We allow TIFF figure export without reportlab (no Info page)
        if not reportlab_installed:
            return
        self.figure_canvas.save()


def export_figure(conn, script_params):

    # make sure we can find all images
    conn.SERVICE_OPTS.setOmeroGroup(-1)

    export_option = script_params['Export_Option']
    print 'exportOption', export_option

    if export_option == 'PDF':
        fig_export = FigureExport(conn, script_params)
    elif export_option == 'PDF_IMAGES':
        fig_export = FigureExport(conn, script_params, export_images=True)
    elif export_option == 'TIFF':
        fig_export = TiffExport(conn, script_params)
    elif export_option == 'TIFF_IMAGES':
        fig_export = TiffExport(conn, script_params, export_images=True)

    return fig_export.buildFigure()


def runScript():
    """
    The main entry point of the script, as called by the client
    via the scripting service, passing the required parameters.
    """

    export_options = [rstring('PDF'), rstring('PDF_IMAGES'),
                      rstring('TIFF'), rstring('TIFF_IMAGES')]

    client = scripts.client(
        'Figure_To_Pdf.py',
        """Used by web.figure to generate pdf figures from json data""",

        scripts.String("Figure_JSON", optional=False,
                       description="All figure info as json stringified"),

        scripts.String("Export_Option", values=export_options,
                       default="PDF"),

        scripts.String("Webclient_URI", grouping="4",
                       description="webclient URL for adding links to images"),

        scripts.String("Figure_Name", grouping="4",
                       description="Name of the Pdf Figure"),

        scripts.String("Figure_URI", description="URL to the Figure")
    )

    try:
        script_params = {}

        conn = BlitzGateway(client_obj=client)

        # process the list of args above.
        for key in client.getInputKeys():
            if client.getInput(key):
                script_params[key] = client.getInput(key, unwrap=True)
        print script_params

        # call the main script - returns a file annotation wrapper
        file_annotation = export_figure(conn, script_params)

        # return this file_annotation to the client.
        client.setOutput("Message", rstring("Pdf Figure created"))
        if file_annotation is not None:
            client.setOutput(
                "File_Annotation",
                robject(file_annotation._obj))

    finally:
        client.closeSession()

if __name__ == "__main__":
    runScript()
