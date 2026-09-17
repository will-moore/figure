#!/usr/bin/env python
# -*- coding: utf-8 -*-
#
# Copyright (c) 2014-2026 University of Dundee.
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

import logging
import json
import numpy
import html

from datetime import datetime
import os
from os import path
from math import atan2, atan, sin, cos, sqrt, radians, floor, ceil, log2
from copy import deepcopy
import re

from io import BytesIO

try:
    from PIL import Image, ImageFont
except ImportError:
    import Image

logger = logging.getLogger('figure_to_pdf')

try:
    import markdown

    markdown_imported = True
except ImportError:
    markdown_imported = False
    logger.error("Markdown not installed. See"
                 " https://pypi.python.org/pypi/Markdown")

try:
    from reportlab.pdfgen import canvas
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.colors import Color
    from reportlab.platypus import Paragraph
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase.pdfmetrics import stringWidth
    reportlab_installed = True
except ImportError:
    reportlab_installed = False
    logger.error("Reportlab not installed.")

VERSION = "0.1.0.dev0"
DEFAULT_OFFSET = 0

ORIGINAL_DIR = "1_originals"
RESAMPLED_DIR = "2_pre_resampled"
FINAL_DIR = "3_final"


# Create a dict we can use for scalebar unit conversions
# TODO: add more units as needed
unit_symbols = {
    "ANGSTROM": {'symbol': "\u00c5", 'microns': 0.0001},
    "CENTIMETER": {'symbol': "cm", 'microns': 10000.0},
    "KILOMETER": {'symbol': "km", 'microns': 1000000000.0},
    "METER": {'symbol': "m", 'microns': 1000000.0},
    "MICROMETER": {'symbol': "\u00b5m", 'microns': 1},
    "MILLIMETER": {'symbol': "mm", 'microns': 1000.0},
    "NANOMETER": {'symbol': "nm", 'microns': 0.001},
}


def get_font(self, fontsize, bold=False, italics=False):
    """ Try to load font from known location """
    # TODO load font from URL
    font = ImageFont.load_default()
    return font


class Bounds(object):

    def __init__(self, *points):
        self.minx = None
        self.maxx = None
        self.miny = None
        self.maxy = None
        for point in points:
            self.add_point(*point)

    def add_point(self, x, y):
        if self.minx is None or x < self.minx:
            self.minx = x
        if self.maxx is None or x > self.maxx:
            self.maxx = x
        if self.miny is None or y < self.miny:
            self.miny = y
        if self.maxy is None or y > self.maxy:
            self.maxy = y

    def get_center(self):
        if self.minx is None:
            return None
        return (self.minx + self.maxx) / 2.0, (self.miny + self.maxy) / 2.0

    def grow(self, pixels):
        if self.minx is None:
            return self
        self.minx -= pixels
        self.miny -= pixels
        self.maxx += pixels
        self.maxy += pixels
        return self

    def round(self):
        self.minx = int(floor(self.minx))
        self.miny = int(floor(self.miny))
        self.maxx = int(ceil(self.maxx))
        self.maxy = int(ceil(self.maxy))
        return self

    def get_size(self):
        if self.minx is None:
            return None
        return (self.maxx - self.minx, self.maxy - self.miny)


class ShapeExport(object):
    # base class for different export formats

    def __init__(self, panel):
        self.panel = panel
        sorted_shapes = []
        text_shapes = []

        # sort shapes to draw text last
        for s in panel.get("shapes", ()):
            if s['type'].lower() == "text":
                text_shapes.append(s)
            else:
                sorted_shapes.append(s)

        sorted_shapes.extend(text_shapes)

        for s in sorted_shapes:
            getattr(self, 'draw_%s' % s['type'].lower(), lambda s: None)(s)

    @staticmethod
    def get_rgb(color):
        # Convert from E.g. '#ff0000' to (255, 0, 0)
        red = int(color[1:3], 16)
        green = int(color[3:5], 16)
        blue = int(color[5:7], 16)
        return (red, green, blue)

    @staticmethod
    def get_rgba_int(color):
        # Convert from E.g. '#ff0000ff' to (255, 0, 0, 255)
        red = int(color[1:3], 16)
        green = int(color[3:5], 16)
        blue = int(color[5:7], 16)
        alpha = int(color[7:9] or 'ff', 16)
        return (red, green, blue, alpha)

    @staticmethod
    def get_rgba(color):
        # Convert from E.g. '#ff0000ff' to (1.0, 0, 0, 1.0)
        return tuple(map(lambda i: i / 255.0, ShapeExport.get_rgba_int(color)))

    @staticmethod
    def apply_transform(tf, point):
        return [
            point[0] * tf['A00'] + point[1] * tf['A01'] + tf['A02'],
            point[0] * tf['A10'] + point[1] * tf['A11'] + tf['A12'],
        ] if tf else point

    @staticmethod
    def apply_rotation(point, centre, rotation):
        cx = centre[0]
        cy = centre[1]
        x = point[0]
        y = point[1]

        dx = cx - x
        dy = cy - y
        # distance of point from centre of rotation
        h = sqrt(dx * dx + dy * dy)
        # and the angle
        angle1 = atan2(dx, dy)

        # Add the rotation to the angle and calculate new
        # opposite and adjacent lengths from centre of rotation
        angle2 = angle1 - radians(rotation)
        newo = sin(angle2) * h
        newa = cos(angle2) * h
        # to give correct x and y within cropped panel
        x = cx - newo
        y = cy - newa
        return x, y

    def draw_rectangle(self, shape):
        # to support rotation/transforms, convert rectangle to a simple
        # four point polygon and draw that instead
        s = deepcopy(shape)
        t = shape.get('transform')

        points = [
            (shape['x'], shape['y']),
            (shape['x'] + shape['width'], shape['y']),
            (shape['x'] + shape['width'], shape['y'] + shape['height']),
            (shape['x'], shape['y'] + shape['height']),
        ]

        if shape.get('rotation', 0) != 0:
            rotation = shape.get('rotation')
            # rotate around centre of rectangle
            cx = shape['x'] + shape['width'] / 2
            cy = shape['y'] + shape['height'] / 2
            points = [
                self.apply_rotation(point, [cx, cy], rotation)
                for point in points
            ]

        s['points'] = ' '.join(','.join(
            map(str, self.apply_transform(t, point))) for point in points)
        self.draw_polygon(s, True)

    def draw_point(self, shape):
        s = deepcopy(shape)
        s['radiusX'] = s['radiusY'] = self.point_radius / self.scale
        self.draw_ellipse(s)


class ShapeToPdfExport(ShapeExport):
    point_radius = 5

    def __init__(self, canvas, panel, page, crop, page_height, page_width):

        self.canvas = canvas
        self.page = page
        # The crop region on the original image coordinates...
        self.crop = crop
        self.page_height = page_height
        self.page_width = page_width
        # Get a mapping from original coordinates to the actual size of panel
        self.scale = float(panel['width']) / crop['width']

        super(ShapeToPdfExport, self).__init__(panel)

    def panel_to_page_coords(self, shape_x, shape_y):
        """
        Convert coordinate from the image onto the PDF page.
        Handles zoom, offset & rotation of panel, rotating the
        x, y point around the centre of the cropped region
        and scaling appropriately.
        Also includes 'inPanel' key - True if point within
        the cropped panel region
        """

        # Apply flip transformations to the shape coordinates
        h_flip = self.panel.get('horizontal_flip', False)
        v_flip = self.panel.get('vertical_flip', False)
        if h_flip:
            shape_x = self.crop['width'] - shape_x + 2 * self.crop['x']
        if v_flip:
            shape_y = self.crop['height'] - shape_y + 2 * self.crop['y']

        rotation = self.panel['rotation']
        if v_flip != h_flip:
            rotation = -rotation
        if rotation != 0:
            # img coords: centre of rotation
            cx = self.crop['x'] + (self.crop['width'] / 2)
            cy = self.crop['y'] + (self.crop['height'] / 2)
            dx = cx - shape_x
            dy = cy - shape_y
            # distance of point from centre of rotation
            h = sqrt(dx * dx + dy * dy)
            # and the angle
            angle1 = atan2(dx, dy)

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

    def draw_shape_label(self, shape, bounds):
        center = bounds.get_center()
        text = html.escape(shape.get('text', ''))
        if not text or not center:
            return
        size = shape.get('fontSize', 12) * 2 / 3
        r, g, b, a = self.get_rgba(shape['strokeColor'])
        # bump up alpha a bit to make text more readable
        rgba = (r, g, b, 0.5 + a / 2.0)
        style = ParagraphStyle(
            'label',
            parent=getSampleStyleSheet()['Normal'],
            alignment=TA_CENTER,
            textColor=Color(*rgba),
            fontSize=size,
            leading=size,
        )
        para = Paragraph(text, style)
        w, h = para.wrap(10000, 100)
        para.drawOn(
            self.canvas, center[0] - w / 2, center[1] - h / 2 + size / 4)

    def draw_text(self, shape):
        text = shape.get('text', '')
        if not shape.get('showText', True) or text == '':
            return

        font_size = shape.get('fontSize', 12)
        stroke_color = shape.get('strokeColor', '#FFFFFF')
        fill_color = shape.get('fillColor', '#000000')
        fill_opacity = float(shape.get('fillOpacity', 0))
        anchor = shape.get('textAnchor', "start")
        text_coords = self.panel_to_page_coords(shape['x'], shape['y'])
        font = "Helvetica"

        # if markdown_imported:
        #     # markdown not supported in JS for text shapes (yet)
        #     text = markdown.markdown(text)

        r, g, b, a = self.get_rgba(stroke_color)
        rgba_text = (r, g, b, a)
        r, g, b, _ = self.get_rgba(fill_color)
        rgba_fill = (r, g, b, fill_opacity)

        x = text_coords["x"]
        y = self.page_height - text_coords["y"]

        text_width = stringWidth(text, font, font_size)
        x0 = 0  # default to left align
        hflip = self.panel.get('horizontal_flip', False)
        if anchor == 'middle':
            x0 = text_width/2
        elif (anchor == "end" and not hflip) or (anchor == "start" and hflip):
            x0 = text_width

        # draw the text background color
        if fill_opacity > 0:
            self.canvas.setFillColorRGB(*rgba_fill)
            pad = 1
            self.canvas.rect(x - x0 - pad,
                             y - font_size * .57 - pad,
                             text_width + pad * 2,
                             font_size * 1.11 + pad, fill=1, stroke=0)

        # draw text
        self.canvas.setFont(font, font_size)
        self.canvas.setFillColorRGB(*rgba_text)
        self.canvas.drawString(
            x - x0,
            y - font_size*.35 - .2,  # Fine tune positioning to match JS layout
            text)

    def draw_line(self, shape):
        start = self.panel_to_page_coords(shape['x1'], shape['y1'])
        end = self.panel_to_page_coords(shape['x2'], shape['y2'])
        x1 = start['x']
        y1 = self.page_height - start['y']
        x2 = end['x']
        y2 = self.page_height - end['y']
        # Don't draw if both points outside panel
        if (start['inPanel'] is False) and (end['inPanel'] is False):
            return

        rgb = self.get_rgb(shape['strokeColor'])
        r = float(rgb[0]) / 255
        g = float(rgb[1]) / 255
        b = float(rgb[2]) / 255
        self.canvas.setStrokeColorRGB(r, g, b)
        stroke_width = float(shape.get('strokeWidth', 1))
        self.canvas.setLineWidth(stroke_width)

        p = self.canvas.beginPath()
        p.moveTo(x1, y1)
        p.lineTo(x2, y2)
        self.canvas.drawPath(p, fill=1, stroke=1)

        self.draw_shape_label(shape, Bounds((x1, y1), (x2, y2)))

    def draw_arrow(self, shape):
        start = self.panel_to_page_coords(shape['x1'], shape['y1'])
        end = self.panel_to_page_coords(shape['x2'], shape['y2'])
        x1 = start['x']
        y1 = self.page_height - start['y']
        x2 = end['x']
        y2 = self.page_height - end['y']
        stroke_width = float(shape.get('strokeWidth', 1))
        # Don't draw if both points outside panel
        if (start['inPanel'] is False) and (end['inPanel'] is False):
            return

        rgb = self.get_rgb(shape['strokeColor'])
        r = float(rgb[0]) / 255
        g = float(rgb[1]) / 255
        b = float(rgb[2]) / 255
        self.canvas.setStrokeColorRGB(r, g, b)
        self.canvas.setFillColorRGB(r, g, b, alpha=1)

        head_size = (stroke_width * 4) + 5
        dx = x2 - x1
        dy = y2 - y1

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

        self.draw_shape_label(shape, Bounds((x1, y1), (x2, y2)))

    def draw_polygon(self, shape, closed=True):
        polygon_in_viewport = False
        points = []
        for point in shape['points'].split(" "):
            # Older polygons/polylines may be 'x,y,'
            xy = point.split(",")
            x = xy[0]
            y = xy[1]
            coords = self.panel_to_page_coords(float(x), float(y))
            points.append([coords['x'], self.page_height - coords['y']])
            polygon_in_viewport = polygon_in_viewport or coords['inPanel']

        # Don't draw if all points outside panel viewport
        if not polygon_in_viewport:
            return

        stroke_width = float(shape.get('strokeWidth', 1))
        r, g, b, a = self.get_rgba(shape['strokeColor'])
        self.canvas.setStrokeColorRGB(r, g, b, alpha=a)
        self.canvas.setLineWidth(stroke_width)

        if 'fillColor' in shape:
            r, g, b, a = self.get_rgba(shape['fillColor'])
            if 'fillOpacity' in shape:
                a = float(shape['fillOpacity'])
            self.canvas.setFillColorRGB(r, g, b, alpha=a)
            fill = 1 if closed else 0
        else:
            fill = 0

        p = self.canvas.beginPath()
        # Go to start...
        p.moveTo(points[0][0], points[0][1])
        # ...around other points...

        for point in points[1:]:
            p.lineTo(point[0], point[1])
        # ...and back over first line
        if closed:
            for point in points[0:2]:
                p.lineTo(point[0], point[1])
        self.canvas.drawPath(p, fill=fill, stroke=1)

        self.draw_shape_label(shape, Bounds(*points))

    def draw_polyline(self, shape):
        self.draw_polygon(shape, False)

    def draw_ellipse(self, shape):
        stroke_width = float(shape.get('strokeWidth', 1))
        c = self.panel_to_page_coords(shape['x'], shape['y'])

        # Don't draw if centre outside panel
        if c['inPanel'] is False:
            return

        cx = c['x']
        cy = self.page_height - c['y']
        rx = shape['radiusX'] * self.scale
        ry = shape['radiusY'] * self.scale

        rotation = shape.get('rotation', 0)
        h_flip = self.panel.get('horizontal_flip', False)
        v_flip = self.panel.get('vertical_flip', False)

        if v_flip:
            rotation = - rotation
        if h_flip:
            rotation = 180 - rotation

        if v_flip != h_flip:
            rotation = (rotation - self.panel['rotation']) * -1
        else:
            rotation = (rotation + self.panel['rotation']) * -1

        r, g, b, a = self.get_rgba(shape['strokeColor'])
        self.canvas.setStrokeColorRGB(r, g, b, alpha=a)

        if 'fillColor' in shape:
            r, g, b, a = self.get_rgba(shape['fillColor'])
            if 'fillOpacity' in shape:
                a = float(shape['fillOpacity'])
            self.canvas.setFillColorRGB(r, g, b, alpha=a)
            fill = 1
        else:
            fill = 0

        label_bounds = Bounds((cx, cy))

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
        self.canvas.drawPath(p, stroke=1, fill=fill)

        # Restore coordinates, rotation etc.
        self.canvas.restoreState()

        self.draw_shape_label(shape, label_bounds)


class FigureExport(object):
    """
    Super class for exporting various figures, such as PDF or TIFF etc.
    """

    def __init__(self, script_params):

        self.script_params = script_params
        # For standalone script, we may have relative or absolute output path
        self.output_path_name = script_params.get("outputPathName")

        figure_json_string = script_params['Figure_JSON']
        self.figure_json = self.version_transform_json(
            self._fix_figure_json(json.loads(figure_json_string)))

        n = datetime.now()
        # time-stamp name by default: Figure_2013-10-29_22-43-53.pdf
        self.figure_name = u"Figure_%s-%s-%s_%s-%s-%s" % (
            n.year, n.month, n.day, n.hour, n.minute, n.second)
        if 'figureName' in self.figure_json:
            self.figure_name = self.figure_json['figureName']

        # get Figure width & height...
        self.page_width = self.figure_json['paper_width']
        self.page_height = self.figure_json['paper_height']

    def _fix_figure_json(self, figure_json):
        """Ensure that the figure JSON is proper.
        """
        # In some cases, dx and dy end up missing or set to null.
        # See issue #257 (missing) and #292 (null value).
        for panel in figure_json['panels']:
            for key in ['dx', 'dy']:
                offset = panel.get(key)
                if offset is None:
                    panel[key] = DEFAULT_OFFSET
        return figure_json

    def version_transform_json(self, figure_json):

        v = figure_json.get('version')
        if v < 3:
            print("Transforming to VERSION 3")
            for p in figure_json['panels']:
                if p.get('export_dpi'):
                    # rename 'export_dpi' attr to 'min_export_dpi'
                    p['min_export_dpi'] = p.get('export_dpi')
                    del p['export_dpi']
                # update strokeWidth to page pixels/coords instead of
                # image pixels. Scale according to size of panel and zoom
                if p.get('shapes') and len(p['shapes']) > 0:
                    image_pixels_width = self.get_crop_region(p)['width']
                    page_coords_width = float(p.get('width'))
                    stroke_width_scale = page_coords_width / image_pixels_width
                    for shape in p['shapes']:
                        stroke_width = float(shape.get('strokeWidth', 1))
                        stroke_width = stroke_width * stroke_width_scale
                        # Set stroke-width to 0.25, 0.5, 0.75, 1 or greater
                        if stroke_width > 0.875:
                            stroke_width = int(round(stroke_width))
                        elif stroke_width > 0.625:
                            stroke_width = 0.75
                        elif stroke_width > 0.375:
                            stroke_width = 0.5
                        else:
                            stroke_width = 0.25
                        shape['strokeWidth'] = stroke_width
        return figure_json

    def get_figure_file_name(self, page=None):
        """
        For PDF export we will only create a single figure file, but
        for TIFF export we may have several pages, so we need unique names
        for each to avoid overwriting.
        This method supports both, simply using different extension
        (pdf/tiff) for each.

        @param page:        If we know a page number we want to use.
        """

        # Extension is pdf or tiff
        fext = self.get_figure_file_ext()

        # For standalone script, we may have relative or absolute output path
        if self.output_path_name is not None:
            name = self.output_path_name
        else:
            # Remove commas: causes problems 'duplicate headers' in download
            name = self.figure_name.replace(",", ".")
            # in case we have path/to/name, just use name
            name = path.basename(name)

        # remove extension
        for ext in ("pdf", "tiff", "tif"):
            if name.endswith("." + ext):
                name = name[0: -len("." + ext)]

        # Name with extension and folder
        full_name = "%s.%s" % (name, fext)
        return full_name

    def build_figure(self):
        """
        The main building of the figure happens here, independently of format.
        We set up directories as needed, call create_figure() to create
        the PDF then iterate through figure pages, adding panels
        for each page.
        Then we add an info page and save the file
        """

        # test to see if we've got multiple pages
        page_count = ('page_count' in self.figure_json and
                      self.figure_json['page_count'] or 1)
        self.page_count = int(page_count)
        paper_spacing = ('paper_spacing' in self.figure_json and
                         self.figure_json['paper_spacing'] or 50)
        page_col_count = ('page_col_count' in self.figure_json and
                          int(self.figure_json['page_col_count']) or 1)

        # Create the figure file(s)
        self.create_figure()

        panels_json = self.figure_json['panels']

        # For each page, add panels...
        col = 0
        row = 0
        for p in range(self.page_count):

            self.add_page_color()

            px = col * (self.page_width + paper_spacing)
            py = row * (self.page_height + paper_spacing)
            page = {'x': px, 'y': py}

            self.add_panels_to_page(panels_json, page)

            # complete page and save
            self.save_page(p)

            col = col + 1
            if col >= page_col_count:
                col = 0
                row = row + 1

        # Add thumbnails and links page
        self.add_info_page(panels_json)

        # Saves the completed figure file
        self.save_figure()


    def get_crop_region(self, panel):
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

        tile_w = orig_w / (zoom / 100)
        tile_h = orig_h / (zoom / 100)

        orig_ratio = float(orig_w) / orig_h
        wh = float(frame_w) / frame_h

        if abs(orig_ratio - wh) > 0.01:
            # if viewport is wider than orig...
            if (orig_ratio < wh):
                tile_h = tile_w / wh
            else:
                tile_w = tile_h * wh

        cropx = ((orig_w - tile_w) / 2) - dx
        cropy = ((orig_h - tile_h) / 2) - dy

        return {'x': cropx, 'y': cropy, 'width': tile_w, 'height': tile_h}

    def get_time_label_text(self, delta_t, format, dec_prec=0):
        """ Gets the text for 'live' time-stamp labels """
        # format of "secs" by default
        is_negative = delta_t < 0
        delta_t = abs(delta_t)
        npad = 2 + dec_prec + (dec_prec > 0)
        if format in ["milliseconds", "ms"]:
            text = "%.*f ms" % (dec_prec, delta_t * 1000)
        elif format in ["secs", "seconds", "s"]:
            text = "%.*f s" % (dec_prec, delta_t)
        elif format in ["mins", "minutes", "m"]:
            text = "%.*f mins" % (dec_prec, delta_t / 60)
        elif format in ["mins:secs", "m:s"]:
            m = int(delta_t // 60)
            s = delta_t % 60
            text = "%s:%0*.*f" % (m, npad, dec_prec, s)
        elif format in ["hrs:mins", "h:m"]:
            h = int(delta_t // 3600)
            m = (delta_t % 3600) / 60
            text = "%s:%0*.*f" % (h, npad, dec_prec, m)
        elif format in ["hrs:mins:secs", "h:m:s"]:
            h = int(delta_t // 3600)
            m = (delta_t % 3600) // 60
            s = delta_t % 60
            text = "%s:%02d:%0*.*f" % (h, m, npad, dec_prec, s)
        else:  # Format unknown
            return ""
        dec_str = "" if dec_prec == 0 else "." + "0" * dec_prec
        if text in ["0" + dec_str + " s", "0:00" + dec_str,
                    "0" + dec_str + " mins", "0:00:00" + dec_str]:
            is_negative = False
        return ('-' if is_negative else '') + text

    def add_rois(self, panel, page):
        """
        Add any Shapes
        """
        if 'border' in panel and panel['border'].get('showBorder'):
            stroke_width = panel['border'].get('strokeWidth')
            r, g, b, a = ShapeExport.get_rgba(panel['border'].get('color'))
            canvas = self.figure_canvas
            canvas.setStrokeColorRGB(r, g, b, alpha=a)
            canvas.setLineWidth(stroke_width)

            # by default, line is drawn in the middle of the path
            # we want it to be on the outside of the xywh coords
            shift_pos = stroke_width / 2

            p = canvas.beginPath()
            x = panel['x'] - shift_pos
            y = panel['y'] - shift_pos
            width = panel['width'] + (shift_pos * 2)
            height = panel['height'] + (shift_pos * 2)

            # Handle page offsets
            x = x - page['x']
            y = y - page['y']

            # rectangle around the panel
            points = [[x, y],
                      [x + width, y],
                      [x + width, y + height],
                      [x, y + height]]

            # flip the y coordinate
            for point in points:
                point[1] = self.page_height - point[1]

            # same logic as draw_polygon()
            p.moveTo(points[0][0], points[0][1])
            for point in points[1:]:
                p.lineTo(point[0], point[1])
            for point in points[0:2]:
                p.lineTo(point[0], point[1])
            canvas.drawPath(p, fill=0, stroke=1)

        if "shapes" not in panel:
            return

        crop = self.get_crop_region(panel)
        ShapeToPdfExport(self.figure_canvas, panel, page, crop,
                         self.page_height, self.page_width)

    def draw_labels(self, panel, page):
        """
        Add the panel labels to the page.
        Here we calculate the position of labels but delegate
        to self.draw_text() to actually place the labels on PDF/TIFF
        """
        labels = panel['labels']
        x = panel['x']
        y = panel['y']
        width = panel['width']
        height = panel['height']
        border = panel.get('border')

        viewport_region = self.get_crop_region(panel)

        # Handle page offsets
        x = x - page['x']
        y = y - page['y']

        # group by 'position':
        positions = {'top': [], 'bottom': [], 'left': [],
                     'leftvert': [], 'right': [], 'rightvert': [],
                     'topleft': [], 'topright': [],
                     'bottomleft': [], 'bottomright': []}

        parse_re = re.compile(r"\[.+?\]")
        for label in labels:
            # Substitution of special label by their values
            new_text = []
            last_idx = 0
            for item in parse_re.finditer(label['text']):
                new_text.append(label['text'][last_idx:item.start()])
                label_value = ""

                expr = item.group()[1:-1].split(";")
                prop_nf = expr[0].strip().split(".")
                param_dict = {}
                for value in expr[1:]:
                    try:
                        kv = value.split("=")
                        if len(kv) > 1:
                            param_dict[kv[0].strip()] = int(kv[1].strip())
                    except ValueError:
                        pass

                offset = param_dict.get("offset", None)
                precision = param_dict.get("precision", None)

                if prop_nf[0] in ["time", "t"]:
                    the_t = panel['theT']
                    timestamps = panel.get('deltaT')
                    # default to index
                    if len(prop_nf) == 1 or prop_nf[1] == "index":
                        label_value = str(the_t + 1)
                    else:
                        d_t = 0
                        if timestamps and the_t < len(timestamps):
                            d_t = timestamps[the_t]
                            if offset is not None:
                                if 1 <= offset <= len(timestamps):
                                    d_t -= timestamps[offset - 1]

                        # Set the default precision value (0) if not given
                        precision = 0 if precision is None else precision

                        label_value = self.get_time_label_text(d_t,
                                                               prop_nf[1],
                                                               precision)

                elif prop_nf[0] == "image":
                    format = prop_nf[1] if len(prop_nf) > 1 else "name"
                    if format == "name":
                        label_value = panel['name'].split('/')[-1]
                    elif format == "id":
                        label_value = str(panel['imageId'])
                    # Escaping "_" for markdown
                    label_value = label_value.replace("_", "\\_")

                elif prop_nf[0] in ["dataset", "project", "plate", "screen",
                                    "run", "acquisition", "well",
                                    "field", "wellsample"]:

                    default_frmt = "name"  # default property format
                    if prop_nf[0] == "well":
                        default_frmt = "label"
                    if prop_nf[0] == "field":
                        default_frmt = "index"
                        prop_nf[0] = "wellsample"  # Also handle aliases
                    if prop_nf[0] == "run":
                        prop_nf[0] = "acquisition"

                    format = prop_nf[1] if len(prop_nf) > 1 else default_frmt

                    if format in ["id", default_frmt]:
                        parent = panel.get("parents", {}).get(prop_nf[0], {})
                        if parent:
                            label_value = str(
                                parent.get(format, '')
                            )
                        else:
                            # undefined value for valid format
                            # e.g the screen id of an image in a dataset
                            label_value = 'undefined'
                    else:
                        # Unknown format, will use original [label]
                        label_value = ''
                    # Escaping "_" for markdown
                    label_value = label_value.replace("_", "\\_")

                elif prop_nf[0] in ['x', 'y', 'z', 'width', 'height',
                                    'w', 'h', 'rotation', 'rot']:
                    format = prop_nf[1] if len(prop_nf) > 1 else "pixel"
                    if format == "px":
                        format = "pixel"
                    prop = prop_nf[0]
                    if prop == "w":
                        prop = "width"
                    elif prop == "h":
                        prop = "height"
                    elif prop == "rot":
                        prop = "rotation"

                    # Set the default precision value (2) if not given
                    precision = 2 if precision is None else precision

                    if prop == "z":
                        size_z = panel.get('sizeZ')
                        pixel_size_z = panel.get('pixel_size_z')
                        z_symbol = panel.get('pixel_size_z_symbol')
                        if pixel_size_z is None:
                            pixel_size_z = 0
                        if z_symbol is None:
                            z_symbol = "\xB5m"

                        if ("z_projection" in panel.keys()
                                and panel["z_projection"]):
                            z_start, z_end = panel["z_start"], panel["z_end"]
                            if format == "pixel":
                                label_value = (str(z_start + 1) + "-"
                                               + str(z_end + 1))
                            elif format == "unit" and size_z:
                                z_start = "%.*f" % (precision,
                                                    (z_start * pixel_size_z))
                                z_end = "%.*f" % (precision,
                                                  (z_end * pixel_size_z))
                                label_value = (z_start + " " + z_symbol + " - "
                                               + z_end + " " + z_symbol)
                        else:
                            the_z = panel['theZ'] if panel['theZ'] else 0
                            if format == "pixel":
                                if offset is not None and 1 <= offset:
                                    the_z -= offset
                                label_value = str(the_z + 1)
                            elif (format == "unit" and size_z
                                  and the_z < size_z):
                                if offset is not None and 1 <= offset:
                                    the_z -= offset
                                z_pos = "%.*f" % (precision,
                                                  (the_z * pixel_size_z))
                                label_value = (z_pos + " " + z_symbol)

                    elif prop == "rotation":
                        label_value = (str(int(panel["rotation"]))
                                       + panel['rotation_symbol'])

                    else:
                        value = viewport_region[prop]
                        if format == "pixel":
                            label_value = str(int(value))
                        elif format == "unit":
                            if prop in ['x', 'width']:
                                scale = panel.get('pixel_size_x')
                            elif prop in ['y', 'height']:
                                scale = panel.get('pixel_size_y')
                            if scale is None:
                                scale = 0
                            rounded = "%.*f" % (precision,
                                                (value * scale))
                            label_value = ("" + rounded +
                                           " " + panel['pixel_size_x_symbol'])

                elif prop_nf[0] in ["channels", "c"]:
                    label_value = []
                    for channel in panel["channels"]:
                        if channel["active"]:
                            label_value.append(channel["label"])
                    label_value = " ".join(label_value)

                elif prop_nf[0] in ["zoom"]:
                    try:
                        zoom = round(panel["zoom"])
                    except Exception:
                        zoom = panel["zoom"]
                    label_value = str(zoom) + " %"
                new_text.append(label_value if label_value else item.group())
                last_idx = item.end()

            new_text.append(label['text'][last_idx:])
            label['text'] = "".join(new_text)
            pos = label['position']
            label['size'] = int(label['size'])  # make sure 'size' is number
            # If page is black and label is black, make label white
            page_color = self.figure_json.get('page_color', 'ffffff').lower()
            label_color = label['color'].lower()
            label_on_page = pos in ('left', 'right', 'top',
                                    'bottom', 'leftvert', 'rightvert')
            if label_on_page:
                if label_color == '000000' and page_color == '000000':
                    label['color'] = 'ffffff'
                if label_color == 'ffffff' and page_color == 'ffffff':
                    label['color'] = '000000'
            if pos in positions:
                positions[pos].append(label)

        def draw_lab(label, lx, ly, align='left'):
            label_h = label['size']
            color = label['color']
            red = int(color[0:2], 16)
            green = int(color[2:4], 16)
            blue = int(color[4:6], 16)
            fontsize = label['size']
            rgb = (red, green, blue)
            text = label['text']

            self.draw_text(text, lx, ly, fontsize, rgb, align=align)
            return label_h

        spacer = 5
        border_width = 0
        if border is not None and border['showBorder']:
            border_width = border['strokeWidth']

        border_spacer = spacer + border_width

        # Render each position:
        for key, labels in positions.items():
            if key == 'topleft':
                lx = x + spacer
                ly = y + spacer
                for label in labels:
                    label_h = draw_lab(label, lx, ly)
                    ly += label_h + spacer
            elif key == 'topright':
                lx = x + width - spacer
                ly = y + spacer
                for label in labels:
                    label_h = draw_lab(label, lx, ly, align='right')
                    ly += label_h + spacer
            elif key == 'bottomleft':
                lx = x + spacer
                ly = y + height
                labels.reverse()  # last item goes bottom
                for label in labels:
                    ly = ly - label['size'] - spacer
                    draw_lab(label, lx, ly)
            elif key == 'bottomright':
                lx = x + width - spacer
                ly = y + height
                labels.reverse()  # last item goes bottom
                for label in labels:
                    ly = ly - label['size'] - spacer
                    draw_lab(label, lx, ly, align='right')
            elif key == 'top':
                lx = x + (width / 2)
                ly = y - border_width
                labels.reverse()
                for label in labels:
                    ly = ly - label['size'] - spacer
                    draw_lab(label, lx, ly, align='center')
            elif key == 'bottom':
                lx = x + (width / 2)
                ly = y + height + border_spacer
                for label in labels:
                    label_h = draw_lab(label, lx, ly, align='center')
                    ly += label_h + spacer
            elif key == 'left':
                lx = x - border_spacer
                sizes = [label['size'] for label in labels]
                total_h = sum(sizes) + spacer * (len(labels) - 1)
                ly = y + (height - total_h) / 2
                for label in labels:
                    label_h = draw_lab(label, lx, ly, align='right')
                    ly += label_h + spacer
            elif key == 'right':
                lx = x + width + border_spacer
                sizes = [label['size'] for label in labels]
                total_h = sum(sizes) + spacer * (len(labels) - 1)
                ly = y + (height - total_h) / 2
                for label in labels:
                    label_h = draw_lab(label, lx, ly)
                    ly += label_h + spacer
            elif key == 'leftvert':
                lx = x - border_spacer
                ly = y + (height / 2)
                labels.reverse()
                for label in labels:
                    lx = lx - label['size'] - spacer
                    draw_lab(label, lx, ly, align='left-vertical')
            elif key == 'rightvert':
                lx = x + width + border_spacer
                ly = y + (height / 2)
                labels.reverse()
                for label in labels:
                    lx = lx + label['size'] + spacer
                    draw_lab(label, lx, ly, align='right-vertical')

    def draw_scalebar(self, panel, region_width, page):
        """
        Add the scalebar to the page.
        Here we calculate the position of scalebar but delegate
        to self.draw_scalebar_line() and self.draw_text() to actually place
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
            v = "Can't show scalebar - pixel_size_x is not defined for panel"
            logger.error(v)
            return

        sb = panel['scalebar']
        spacer = sb.get('margin', 10)

        color = sb['color']
        red = int(color[0:2], 16)
        green = int(color[2:4], 16)
        blue = int(color[4:6], 16)

        position = 'position' in sb and sb['position'] or 'bottomright'
        align = 'left'

        half_height = sb.get('height', 3) // 2
        if position == 'topleft':
            lx = x + spacer
            ly = y + spacer + half_height
        elif position == 'topright':
            lx = x + width - spacer
            ly = y + spacer + half_height
            align = "right"
        elif position == 'bottomleft':
            lx = x + spacer
            ly = y + height - spacer - half_height
        elif position == 'bottomright':
            lx = x + width - spacer
            ly = y + height - spacer - half_height
            align = "right"

        pixel_size_x = panel['pixel_size_x']

        # If we previously calculated the zoom scale for big image rendering
        # Use this again here to scale the pixel size
        # TODO: FIXME: need to calculate scale from the size of the image, zoom etc.
        if 'zoom_level_scale' in panel:
            scale = panel['zoom_level_scale']
            pixel_size_x = pixel_size_x / scale

        pixels_length = sb['length'] / pixel_size_x

        scale_to_canvas = panel['width'] / float(region_width)
        canvas_length = pixels_length * scale_to_canvas

        pixel_unit = panel.get('pixel_size_x_unit')
        # if older file doesn't have scalebar.unit, use pixel unit
        scalebar_unit = sb.get('units', pixel_unit)
        if pixel_unit in unit_symbols and scalebar_unit in unit_symbols:
            convert_factor = (unit_symbols[scalebar_unit]['microns'] /
                              unit_symbols[pixel_unit]['microns'])
            canvas_length = convert_factor * canvas_length

        if align == 'left':
            lx_end = lx + canvas_length
        else:
            lx_end = lx - canvas_length

        self.draw_scalebar_line(lx, ly, lx_end, ly, sb.get("height", 3),
                                (red, green, blue))

        if 'show_label' in sb and sb['show_label']:
            symbol = u"\u00B5m"
            if 'pixel_size_x_symbol' in panel:
                symbol = panel['pixel_size_x_symbol']
            if scalebar_unit and scalebar_unit in unit_symbols:
                symbol = unit_symbols[scalebar_unit]['symbol']
            label = "%s %s" % (sb['length'], symbol)
            font_size = 10
            try:
                font_size = int(sb.get('font_size'))
            except Exception:
                pass

            # For 'bottom' scalebar, put label above
            # 5 is an empirically determined offset that "works"
            if 'bottom' in position:
                ly = ly - font_size - 5
            else:
                ly = ly + 5

            self.draw_text(
                label, (lx + lx_end) / 2,
                ly + ((-1 if position in ["bottomleft", "bottomright"]
                       else 1) * half_height),
                font_size, (red, green, blue),
                align="center")

    def get_color_ramp(self, channel):
        """
        Return the (1, 256, 3) array of the LUT from
        the color gradient.

        TODO: figure app should provide color_ramp in the figure.json for LUTs
        """
        color = channel["color"]

        # FIXME: if lut, we return a greyscale ramp
        if color.endswith(".lut"):
            color = "FFFFFF"

        # Convert the hexadecimal string to RGB
        color_ramp = None
        if len(color) == 6:
            try:
                r = int(color[0:2], 16)
                g = int(color[2:4], 16)
                b = int(color[4:6], 16)
                color_ramp = (numpy.linspace(0, 1, 256).reshape(-1, 1)
                              * numpy.array([r, g, b], dtype=numpy.uint8).T)
                color_ramp = color_ramp.astype(numpy.uint8)
            except ValueError:
                pass
        if channel.get("reverseIntensity", False):
            color_ramp = color_ramp[::-1]

        if color_ramp is None:
            return numpy.zeros((1, 256, 3), dtype=numpy.uint8)
        else:
            return color_ramp[numpy.newaxis]

    def draw_colorbar(self, panel, page):
        """
        Add the colorbar to the page.
        Here we calculate the position of colorbar but delegate
        to self.draw_scalebar_line() and self.draw_text() to actually place
        the colorbar, ticks and labels on PDF/TIFF
        """

        colorbar = panel.get("colorbar", {})
        if not colorbar.get("show", False):
            return

        channel = None
        for c in panel["channels"]:
            if c["active"]:
                channel = c
                break
        if not channel:
            return

        color_ramp = self.get_color_ramp(channel)

        gap = colorbar["gap"]
        thickness = colorbar["thickness"]
        ramp_d = {  # Dict of color ramp properties to pass to paste_image
            'zoom': '100',
            'dx': 0,
            'dy': 0,
            'orig_height': panel['orig_height'],
            'orig_width': panel['orig_width']
        }
        start, end = channel["window"]["start"], channel["window"]["end"]

        decimals = max(0, int(numpy.ceil(
            -numpy.log10((end - start) / colorbar["num_ticks"]))))
        labels = numpy.linspace(start, end, num=colorbar["num_ticks"])
        # Round the label str to the appropriate decimal
        labels = [f"{label:.{decimals}f}" for label in labels]

        pos_ratio = numpy.linspace(0, 1, colorbar["num_ticks"])
        if colorbar["position"] in ["left", "right"]:
            color_ramp = color_ramp.transpose((1, 0, 2))[::-1]
            ramp_d['width'] = thickness
            ramp_d['height'] = panel['height']
            ramp_d['y'] = panel['y']
            ramp_d['x'] = panel['x'] - (gap + thickness)
            labels_x = [ramp_d['x']]
            labels_y = ramp_d['y'] + panel['height'] * pos_ratio
            labels = labels[::-1]
            ramp_d["align"] = "right"
            if colorbar["position"] == "right":
                ramp_d['x'] = panel['x'] + panel['width'] + gap
                labels_x = [ramp_d['x'] + ramp_d['width']]
                ramp_d["align"] = "left"
            labels_x *= len(labels)  # Duplicate x postions
        elif colorbar["position"] in ["top", "bottom"]:
            ramp_d['width'] = panel['width']
            ramp_d['height'] = thickness
            ramp_d['x'] = panel['x']
            ramp_d['y'] = panel['y'] - (gap + thickness)
            labels_x = ramp_d['x'] + panel['width'] * pos_ratio
            labels_y = [ramp_d['y']]
            ramp_d["align"] = "center"
            if colorbar["position"] == "bottom":
                ramp_d['y'] = panel['y'] + panel['height'] + gap
                labels_y = [ramp_d['y'] + ramp_d['height']]
            labels_y *= len(labels)  # Duplicate y postions

        pil_img = Image.fromarray(color_ramp)
        img_name = channel["color"] + ".png"

        # for PDF export, we might have a target dpi
        dpi = panel.get('min_export_dpi', None)

        # Paste the panel to PDF or TIFF image
        self.paste_image(pil_img, img_name, ramp_d, page, dpi,
                         is_colorbar=True)

        # Handle page offsets
        ramp_d['x'] -= page['x']
        ramp_d['y'] -= page['y']
        labels_x = numpy.array(labels_x) - page['x']
        labels_y = numpy.array(labels_y) - page['y']

        self.draw_colorbar_ticks(colorbar, ramp_d, labels, labels_x, labels_y)

    def draw_colorbar_ticks(self, colorbar, ramp_d, labels,
                            labels_x, labels_y):
        """ Adds colorbar spine and tick to PDF. Overwritten for TIFF below """

        fontsize = int(colorbar["font_size"])
        mark_len = colorbar["mark_len"]
        tick_margin = colorbar["tick_margin"]
        pos = colorbar["position"]
        tick_thickness = colorbar.get("tick_thickness", 1)
        rgb = colorbar["axis_color"]
        rgb = tuple(int(rgb[i:i+2], 16) for i in (0, 2, 4))

        align = ramp_d["align"]

        # Drawing of the ticks (line + label)
        for label, pos_x, pos_y in zip(labels, labels_x, labels_y):
            # Cosmetic correction, for first and last ticks to be
            # aligned with the image
            shift = 0
            if label == labels[0]:
                shift = -tick_thickness / 2
            elif label == labels[-1]:
                shift = tick_thickness / 2

            if pos in ["left", "right"]:
                pos_y -= shift
                x1 = pos_x
                y1 = pos_y
                y2 = pos_y
                y_txt = pos_y - fontsize / 2 + 1

                if pos == "left":
                    x2 = pos_x - mark_len
                    x_txt = pos_x - mark_len - tick_margin
                else:
                    x2 = pos_x + mark_len
                    x_txt = pos_x + mark_len + tick_margin

            elif pos in ["top", "bottom"]:
                pos_x -= shift
                x1 = pos_x
                x2 = pos_x
                y1 = pos_y
                x_txt = pos_x
                if pos == "top":
                    y2 = pos_y - mark_len
                    y_txt = pos_y - fontsize - mark_len - tick_margin
                else:
                    y2 = pos_y + mark_len
                    y_txt = pos_y + mark_len + tick_margin

            if mark_len > 0:  # Do not add empty elements
                self.draw_scalebar_line(x1, y1, x2, y2,
                                        tick_thickness, rgb)
            self.draw_text(label, x_txt, y_txt, fontsize, rgb, align=align)

        if pos in ["top", "bottom"]:
            x1 = ramp_d['x']
            x2 = ramp_d['x'] + ramp_d['width']
            y1 = ramp_d['y']
            if pos == "bottom":
                y1 += ramp_d['height']
            y2 = y1

        elif pos in ["left", "right"]:
            x1 = ramp_d['x']
            y1 = ramp_d['y']
            y2 = ramp_d['y'] + ramp_d['height']
            if pos == "right":
                x1 += ramp_d['width']
            x2 = x1

        self.draw_scalebar_line(x1, y1, x2, y2, tick_thickness, rgb)

    def get_panel_image(self, panel, orig_name=None):
        """
        Renders the 'src' data:url of the panel as a PIL image
        """

        pil_img = None

        # open PIL Image from "src": "data:image/png;base64,..."
        import base64
        from io import BytesIO
        src = panel.get('src')
        if src and src.startswith("data:image/png;base64,"):
            base64_data = src.split(",")[1]
            image_data = base64.b64decode(base64_data)
            pil_img = Image.open(BytesIO(image_data))

        if pil_img is None:
            return

        if orig_name is not None:
            pil_img.save(orig_name)

        return pil_img

    def draw_panel(self, panel, page, idx):
        """
        Renders image to PIL image, then
        calls self.paste_image() to add it to PDF or TIFF figure.
        """

        img_name = "panel"
        img_name = "%s_%s.tiff" % (idx, img_name)

        # get cropped image (saving original)
        orig_name = None
        pil_img = self.get_panel_image(panel, orig_name)

        # for PDF export, we might have a target dpi
        dpi = panel.get('min_export_dpi', None)

        # Paste the panel to PDF or TIFF image
        self.paste_image(pil_img, img_name, panel, page, dpi)

        return pil_img

    def get_thumbnail(self, panel, idx):
        """ Saves thumb as local jpg and returns name """

        pil_img = self.get_panel_image(panel)
        # resize so that longest side is 96 pixels
        w, h = pil_img.size
        if w > h:
            new_w = 96
            new_h = int(h * (96 / w))
        else:
            new_h = 96
            new_w = int(w * (96 / h))
        pil_img = pil_img.resize((new_w, new_h))
        temp_name = str(idx) + "_thumb.png"
        pil_img.save(temp_name)
        return temp_name

    def add_para_with_thumb(self, text, page_y, style, thumb_src=None):
        """ Adds paragraph text to point on PDF info page """

        c = self.figure_canvas
        margin = self.margin
        aw = self.page_width - (margin * 2)
        maxh = self.page_height - margin
        spacer = 10
        imgw = imgh = 25
        # Some html from markdown may not be compatible
        # with adding to PDF.
        try:
            para = Paragraph(text, style)
        except ValueError:
            logger.error("Couldn't add paragraph to PDF: %s" % text)
            text = "[Failed to format paragraph - not shown]"
            para = Paragraph(text, style)
        w, h = para.wrap(aw, page_y)  # find required space
        if thumb_src is not None:
            parah = max(h, imgh)
        else:
            parah = h
        # If there's not enough space, start a new page
        if parah > (page_y - margin):
            c.showPage()
            page_y = maxh  # reset to top of new page
        if thumb_src is not None:
            c.drawImage(thumb_src, margin, page_y - imgh, imgw, imgh)
            margin = margin + imgw + spacer
        para.drawOn(c, margin, page_y - h)
        return page_y - parah - spacer  # reduce the available height

    def add_info_page(self, panels_json):
        """Generates a PDF info page with figure title, links to images etc"""
        script_params = self.script_params
        figure_name = self.figure_name
        base_url = None
        if 'Webclient_URI' in script_params:
            base_url = script_params['Webclient_URI']
        page_height = self.page_height

        # Need to sort panels from top (left) -> bottom of Figure
        panels_json.sort(key=lambda x: int(x['y']) + x['y'] * 0.01)

        img_ids = set()
        styles = getSampleStyleSheet()
        style_n = styles['Normal']
        style_h = styles['Heading1']
        style_h3 = styles['Heading3']

        scalebars = []
        self.margin = min(self.page_width, self.page_height) / 9.0

        # Start adding at the top, update page_y as we add paragraphs
        page_y = page_height - self.margin
        page_y = self.add_para_with_thumb(figure_name, page_y, style=style_h)

        if "Figure_URI" in script_params:
            file_url = script_params["Figure_URI"]
            figure_link = ("Link to Figure: <a href='%s' color='blue'>%s</a>"
                           % (file_url, file_url))
            page_y = self.add_para_with_thumb(figure_link, page_y,
                                              style=style_n)

        # Add Figure Legend
        if ('legend' in self.figure_json and
                len(self.figure_json['legend']) > 0):
            page_y = self.add_para_with_thumb("Legend:", page_y,
                                              style=style_h3)
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
                    page_y = self.add_para_with_thumb(p, page_y, style=style_n)
            else:
                page_y = self.add_para_with_thumb(legend, page_y,
                                                  style=style_n)

        page_y = self.add_para_with_thumb(
            "Figure contains the following images:", page_y, style=style_h3)

        # Go through sorted panels, adding paragraph for each unique image
        for idx, p in enumerate(panels_json):
            iid = p['imageId']
            # list unique scalebar lengths
            if 'scalebar' in p and p['scalebar'].get('show'):
                sb_length = p['scalebar'].get('length')
                symbol = u"\u00B5m"
                sb_units = p['scalebar'].get('units')
                if sb_units and sb_units in unit_symbols:
                    symbol = unit_symbols[sb_units]['symbol']
                scalebars.append("%s %s" % (sb_length, symbol))
            if iid in img_ids:
                continue  # ignore images we've already handled
            img_ids.add(iid)
            thumb_src = self.get_thumbnail(p, idx)
            # thumb = "<img src='%s' width='%s' height='%s' " \
            #         "valign='middle' />" % (thumbSrc, thumbSize, thumbSize)
            lines = []
            lines.append(p['name'])
            try:
                img_url = "%s?show=image-%s" % (base_url, int(iid))
            except ValueError:
                img_url = iid
            lines.append(
                "<a href='%s' color='blue'>%s</a>" % (img_url, img_url))
            # addPara([" ".join(line)])
            line = " ".join(lines)
            page_y = self.add_para_with_thumb(
                line, page_y, style=style_n, thumb_src=thumb_src)

        if len(scalebars) > 0:
            scalebars = list(set(scalebars))
            page_y = self.add_para_with_thumb("Scalebars:", page_y,
                                              style=style_h3)
            page_y = self.add_para_with_thumb(
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

    def add_panels_to_page(self, panels_json, page):
        """ Add panels that are within the bounds of this page """
        for i, panel in enumerate(panels_json):

            if not self.panel_is_on_page(panel, page):
                continue

            # draw_panel() creates PIL image then applies it to the page.
            # For TIFF export, draw_panel() also adds shapes to the
            # PIL image before pasting onto the page...
            pil_img = self.draw_panel(panel, page, i)

            # ... but for PDF we have to add shapes to the whole PDF page
            self.add_rois(panel, page)  # This does nothing for TIFF export

            # Finally, add scale bar and labels to the page
            self.draw_scalebar(panel, pil_img.size[0], page)
            self.draw_labels(panel, page)
            self.draw_colorbar(panel, page)

    def get_figure_file_ext(self):
        return "pdf"

    def create_figure(self):
        """
        Creates a PDF figure. This is overwritten by ExportTiff subclass.
        """
        if not reportlab_installed:
            raise ImportError(
                "Need to install https://bitbucket.org/rptlab/reportlab")
        name = self.get_figure_file_name()
        self.figure_canvas = canvas.Canvas(
            name, pagesize=(self.page_width, self.page_height))

    def add_page_color(self):
        """ Simply draw colored rectangle over whole current page."""
        page_color = self.figure_json.get('page_color')
        if page_color and page_color.lower() != 'ffffff':
            rgb = ShapeToPdfExport.get_rgb('#' + page_color)
            r = float(rgb[0]) / 255
            g = float(rgb[1]) / 255
            b = float(rgb[2]) / 255
            self.figure_canvas.setStrokeColorRGB(r, g, b)
            self.figure_canvas.setFillColorRGB(r, g, b)
            self.figure_canvas.setLineWidth(4)
            self.figure_canvas.rect(0, 0, self.page_width,
                                    self.page_height, fill=1)

    def save_page(self, page=None):
        """ Called on completion of each page. Saves page of PDF """
        self.figure_canvas.showPage()

    def save_figure(self):
        """ Completes PDF figure (or info-page PDF for TIFF export) """
        self.figure_canvas.save()

    def draw_text(self, text, x, y, fontsize, rgb, align="center"):
        """ Adds text to PDF. Overwritten for TIFF below """
        if markdown_imported:
            # convert markdown to html
            text = markdown.markdown(text)

        y = self.page_height - y
        c = self.figure_canvas
        # Needs to be wide enough to avoid wrapping
        para_width = self.page_width

        red, green, blue = rgb
        red = float(red) / 255
        green = float(green) / 255
        blue = float(blue) / 255

        alignment = TA_LEFT
        if (align == "center"):
            alignment = TA_CENTER
            x = x - (para_width / 2)
        elif (align == "right"):
            alignment = TA_RIGHT
            x = x - para_width
        elif (align == "left"):
            pass
        elif align == 'left-vertical':
            # Switch axes
            c.rotate(90)
            px = x
            x = y
            y = -px
            # Align center
            alignment = TA_CENTER
            x = x - (para_width / 2)
        elif align == 'right-vertical':
            # Switch axes
            c.rotate(-90)
            px = x
            x = -y
            y = px
            # Align center
            alignment = TA_CENTER
            x = x - (para_width / 2)

        # set fully opaque background color to avoid transparent text
        c.setFillColorRGB(0, 0, 0, 1)

        style_n = getSampleStyleSheet()['Normal']
        style = ParagraphStyle(
            'label',
            parent=style_n,
            alignment=alignment,
            textColor=(red, green, blue),
            fontSize=fontsize)

        para = Paragraph(text, style)
        w, h = para.wrap(para_width, y)  # find required space
        para.drawOn(c, x, y - h + int(fontsize * 0.25))

        # Rotate back again
        if align == 'left-vertical':
            c.rotate(-90)
        elif align == 'right-vertical':
            c.rotate(90)

    def draw_scalebar_line(self, x, y, x2, y2, width, rgb):
        """ Adds line to PDF. Overwritten for TIFF below """
        red, green, blue = rgb
        red = float(red) / 255
        green = float(green) / 255
        blue = float(blue) / 255

        y = self.page_height - y
        y2 = self.page_height - y2
        c = self.figure_canvas
        c.setLineWidth(width)
        c.setStrokeColorRGB(red, green, blue, 1)
        c.line(x, y, x2, y2)

    def paste_image(self, pil_img, img_name, panel, page, dpi,
                    is_colorbar=False):
        """ Adds the PIL image to the PDF figure. Overwritten for TIFFs """

        # Apply flip transformations before drawing the image
        h_flip = panel.get('horizontal_flip', False)
        v_flip = panel.get('vertical_flip', False)

        if h_flip:
            pil_img = pil_img.transpose(Image.FLIP_LEFT_RIGHT)
        if v_flip:
            pil_img = pil_img.transpose(Image.FLIP_TOP_BOTTOM)

        x = panel['x']
        y = panel['y']
        width = panel['width']
        height = panel['height']
        # Handle page offsets
        x = x - page['x']
        y = y - page['y']

        if dpi is not None:
            # E.g. target is 300 dpi and width & height is '72 dpi'
            # so we need image to be width * dpi/72 pixels
            target_w = (width * dpi) / 72
            curr_w, curr_h = pil_img.size
            dpi_scale = float(target_w) / curr_w
            target_h = dpi_scale * curr_h
            target_w = int(round(target_w))
            target_h = int(round(target_h))
            if target_w > curr_w:
                pil_img = pil_img.resize((target_w, target_h), Image.BICUBIC)

        if is_colorbar:
            # Save the image to a BytesIO stream
            buffer = BytesIO()
            pil_img.save(buffer, format="PNG")
            buffer.seek(0)
            img_name = ImageReader(buffer)  # drawImage accepts ImageReader
        else:
            # Save Image to file, then bring into PDF
            pil_img.save(img_name)
        # Since coordinate system is 'bottom-up', convert from 'top-down'
        y = self.page_height - height - y
        # set fill color alpha to fully opaque, since this impacts drawImage
        self.figure_canvas.setFillColorRGB(0, 0, 0, alpha=1)
        self.figure_canvas.drawImage(img_name, x, y, width, height)


def handle_main():

    import argparse
    parser = argparse.ArgumentParser(description='Test Figure to PDF export')
    parser.add_argument("file", help="Path to Figure JSON file")
    parser.add_argument('outputPathName',
                        help=("Relative or absolute path/to/output.pdf. "
                              "Extension is used to set export file type"))
    args = parser.parse_args()

    fpath = args.file
    with open(fpath, 'r') as f:
        figure_json = json.load(f)

    output_path_name = args.outputPathName
    fext = output_path_name.split('.')[-1].lower()
    file_type = "TIFF" if fext in ['tif', 'tiff'] else "PDF"

    script_args = {
        "Figure_JSON": json.dumps(figure_json),
        "Export_Option": file_type,
        "outputPathName": output_path_name,
        "Webclient_URI": "http://localhost/webclient/"
    }

    fig_export = FigureExport(script_args)
    fig_export.build_figure()

if __name__ == "__main__":
    handle_main()
