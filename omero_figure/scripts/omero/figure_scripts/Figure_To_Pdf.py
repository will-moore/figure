#!/usr/bin/env python
# -*- coding: utf-8 -*-
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

import logging
import json
import numpy
import html

from datetime import datetime
import os
from os import path
import zipfile
from math import atan2, atan, sin, cos, sqrt, radians, floor, ceil, log2, fmod
from copy import deepcopy
import re

from omero.model import ImageAnnotationLinkI, ImageI, LengthI
import omero.scripts as scripts
from omero.gateway import BlitzGateway
from omero.rtypes import rstring, robject
from omero.model.enums import UnitsLength

from io import BytesIO

from reportlab.pdfbase.pdfmetrics import stringWidth

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    import Image
    import ImageDraw

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
    reportlab_installed = True
except ImportError:
    reportlab_installed = False
    logger.error("Reportlab not installed.")

DEFAULT_OFFSET = 0

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

# Create a dict we can use for scalebar unit conversions
unit_symbols = {}
for name in LengthI.SYMBOLS.keys():
    if name in ("PIXEL", "REFERENCEFRAME"):
        continue
    klass = getattr(UnitsLength, name)
    unit = LengthI(1, klass)
    to_microns = LengthI(unit, UnitsLength.MICROMETER)
    unit_symbols[name] = {
        'symbol': unit.getSymbol(),
        'microns': to_microns.getValue()
    }


def scale_to_export_dpi(pixels):
    """
    Original figure coordinates assume 72 dpi figure, but we want to
    export at 300 dpi, so everything needs scaling accordingly
    """
    return int(round(pixels * 300 / 72))


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
        for s in panel.get("shapes", ()):
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
        if not shape.get('showText', True):
            return

        text_coords = self.panel_to_page_coords(shape['x'], shape['y'])
        raw_text = shape.get('text')
        text = ""

        if markdown_imported:
            # convert markdown to html
            text = markdown.markdown(raw_text)

        size = shape.get('fontSize', 12)
        stroke_width = shape.get('strokeWidth', 2)
        r, g, b, a = self.get_rgba(shape['textColor'])
        # bump up alpha a bit to make text more readable
        rgba = (r, g, b, 0.5 + a / 2.0)

        x0 = text_coords["x"]
        y0 = self.page_height - text_coords["y"]
        anchor = shape['textAnchor']
        alignment = TA_LEFT

        # handle flipping
        h_flip = self.panel.get('horizontal_flip', False)
        if h_flip and anchor == 'start':
            anchor = "end"

        # handle shifting according to the test anchor
        x = x0
        if anchor == 'middle':
            alignment = TA_CENTER
            x = x0 - (self.page_width / 2)
        elif anchor == "end":
            alignment = TA_RIGHT
            x = x0 - self.page_width

        font_name = "Helvetica"
        style = ParagraphStyle(
            'label',
            parent=getSampleStyleSheet()['Normal'],
            alignment=alignment,
            textColor=Color(*rgba),
            fontSize=size,
            font_name=font_name,
            leading=size,
        )
        para = Paragraph(text, style)
        w, h = para.wrap(self.page_width, y0)

        rotation = shape.get('textRotation', 0)
        panel_rotation = shape.get('rotation', 0)
        rotation = rotation + panel_rotation

        # preparing offsets according to text position
        text_position = shape['textPosition']
        text_offset_x = stroke_width / 4 + 4
        text_offset_y = size / 2 + stroke_width / 4 + 4
        out_positions = ["top", "left", "bottom", "right"]
        in_positions = ["topleft", "bottomleft", "bottomright", "topright"]
        rotation_index = fmod(floor((360 - rotation + 45) / 90), 4)
        final_index = 0

        if text_position in out_positions:
            pos_index = out_positions.index(text_position)
            final_index = int(fmod((pos_index + rotation_index), 4))
            text_position = out_positions[final_index]
        if text_position in in_positions:
            pos_index = in_positions.index(text_position)
            final_index = int(fmod((pos_index + rotation_index), 4))
            text_position = in_positions[final_index]

        dx, dy, padding_y = 0, 0, 0
        if text_position == "bottom":
            dx = 0
            dy = text_offset_y
            padding_y = - 2 * dy
        if text_position == "left":
            dx = -text_offset_x
            dy = size * 0.4
            padding_y = - 2 * dy
        if text_position == "right":
            dx = text_offset_x
            dy = size * 0.4
            padding_y = - 2 * dy
        if text_position == "top":
            dx = 0
            dy = -stroke_width / 2
        if text_position == "topleft":
            dx = text_offset_x
            dy = text_offset_y
            padding_y = - 2 * dy
        if text_position == "topright":
            dx = -text_offset_x
            dy = text_offset_y
            padding_y = - 2 * dy
        if text_position == "bottomleft":
            dx = text_offset_x
            dy = -stroke_width / 2
        if text_position == "bottomright":
            dx = -text_offset_x
            dy = -stroke_width / 2
        if text_position == "center":
            dx = 0
            dy = size * 0.4
            padding_y = - 2 * dy
        if text_position == "freehand":
            dx = 0
            dy = 0

        # draw the text background color
        if float(shape.get('textBackgroundOpacity', 0)) > 0:
            r, g, b, a = self.get_rgba(shape['textBackgroundColor'])
            a = float(shape['textBackgroundOpacity'])
            self.canvas.setFillColorRGB(r, g, b, alpha=a)
            text_width = stringWidth(raw_text, font_name, size)

            # padding inside the background box
            padding_h, padding_v = 3, size/4 + 1
            padding_x = 0
            if anchor == 'middle':
                padding_x = -(text_width / 2 + padding_h)
            elif anchor == "end":
                padding_x = -(text_width + 2 * padding_h)

            box_width = text_width + padding_h * 2
            box_height = size + padding_v

            self.canvas.rect(x0 + padding_x, y0 + dy + padding_y - padding_v,
                             box_width, box_height, fill=1, stroke=0)

        # draw text
        para.drawOn(self.canvas, x + dx, y0 - dy)

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


class ShapeToPilExport(ShapeExport):
    """
    Class for drawing panel shapes onto a PIL image.
    We get a PIL image, the panel dict, and crop coordinates
    """

    point_radius = 25

    def __init__(self, pil_img, panel, crop):

        self.pil_img = pil_img
        self.panel = panel
        # The crop region on the original image coordinates...
        self.crop = crop
        self.scale = pil_img.size[0] / crop['width']
        self.draw = ImageDraw.Draw(pil_img)
        super(ShapeToPilExport, self).__init__(panel)

    def get_panel_coords(self, shape_x, shape_y):
        """
        Convert coordinate from the image onto the panel.
        Handles zoom, offset & rotation of panel, rotating the
        x, y point around the centre of the cropped region
        and scaling appropriately
        """
        h_flip = self.panel.get('horizontal_flip', False)
        v_flip = self.panel.get('vertical_flip', False)

        # Apply flip transformations to the shape coordinates
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
        shape_x = (shape_x - self.crop['x']) * self.scale
        shape_y = (shape_y - self.crop['y']) * self.scale

        return {'x': shape_x, 'y': shape_y}

    def draw_shape_label(self, shape, bounds):
        center = bounds.get_center()
        text = shape.get('text')
        size = int(shape.get('fontSize', 12) * 2.5)
        if not text or not center:
            return
        r, g, b, a = self.get_rgba_int(shape['strokeColor'])
        # bump up alpha a bit to make text more readable
        rgba = (r, g, b, int(128 + a / 2))
        font_name = "FreeSans.ttf"
        from omero.gateway import THISPATH
        path_to_font = os.path.join(THISPATH, "pilfonts", font_name)
        try:
            font = ImageFont.truetype(path_to_font, size)
        except Exception:
            font = ImageFont.load(
                '%s/pilfonts/B%0.2d.pil' % (self.GATEWAYPATH, size))
        box = font.getbbox(text)
        width = box[2] - box[0]
        height = box[3] - box[1]
        xy = (int(center[0] - width / 2.0), int(center[1] - height / 2.0))
        self.draw.text(xy, text, fill=rgba, font=font)

    def draw_text(self, shape):
        print(shape)
        if not shape.get('showText', True):
            return

        text_coords = self.get_panel_coords(shape['x'], shape['y'])
        text = shape.get('text', '')

        font_size_dpi = scale_to_export_dpi(shape.get('fontSize', 12))
        stroke_width = shape.get('strokeWidth', 2)
        stroke_width_dpi = scale_to_export_dpi(float(stroke_width))

        r, g, b, a = self.get_rgba_int(shape['textColor'])
        # bump up alpha a bit to make text more readable
        rgba = (r, g, b, int(128 + a / 2))
        font_name = "FreeSans.ttf"
        from omero.gateway import THISPATH
        path_to_font = os.path.join(THISPATH, "pilfonts", font_name)
        try:
            font = ImageFont.truetype(path_to_font, font_size_dpi)
        except Exception:
            font = ImageFont.load(
                '%s/pilfonts/B%0.2d.pil' % (self.GATEWAYPATH, font_size_dpi))

        box = font.getbbox(text)
        txt_w = box[2] - box[0]
        txt_h = box[3] - box[1]

        x = text_coords["x"]
        y = text_coords["y"]
        anchor = shape['textAnchor']

        # handle flipping
        h_flip = self.panel.get('horizontal_flip', False)
        if h_flip and anchor == 'start':
            anchor = "end"

        # handle horizontal offset according to text anchor
        if anchor == 'middle':
            x = x - txt_w / 2
        elif anchor == "end":
            x = x - txt_w

        rotation = shape.get('textRotation', 0)
        panel_rotation = shape.get('rotation', 0)
        rotation = rotation + panel_rotation

        # Adjusting x/y offsets according to text position
        text_position = shape['textPosition']
        text_offset_x = scale_to_export_dpi(stroke_width / 4 + 4)
        out_positions = ["top", "left", "bottom", "right"]
        in_positions = ["topleft", "bottomleft", "bottomright", "topright"]
        rotation_index = fmod(floor((360 - rotation + 45) / 90), 4)
        final_index = 0

        if text_position in out_positions:
            pos_index = out_positions.index(text_position)
            final_index = int(fmod((pos_index + rotation_index), 4))
            text_position = out_positions[final_index]
        if text_position in in_positions:
            pos_index = in_positions.index(text_position)
            final_index = int(fmod((pos_index + rotation_index), 4))
            text_position = in_positions[final_index]

        if text_position == "bottom":
            dx = 0
            dy = stroke_width_dpi / 4
        if text_position == "left":
            dx = -text_offset_x
            dy = -txt_h * 0.8
        if text_position == "right":
            dx = text_offset_x
            dy = -txt_h * 0.8
        if text_position == "top":
            dx = 0
            dy = -font_size_dpi - stroke_width_dpi / 2
        if text_position == "topleft":
            dx = text_offset_x
            dy = 2
        if text_position == "topright":
            dx = -text_offset_x
            dy = 2
        if text_position == "bottomleft":
            dx = text_offset_x
            dy = -font_size_dpi - stroke_width_dpi / 2
        if text_position == "bottomright":
            dx = -text_offset_x
            dy = -font_size_dpi - stroke_width_dpi / 2
        if text_position == "center":
            dx = 0
            dy = -txt_h * 0.8
        if text_position == "freehand":
            dx = 0
            dy = -txt_h * 0.8

        xy = (x + dx, y + dy)

        # draw background color
        if float(shape.get('textBackgroundOpacity', 0)) > 0:
            txt_offset = scale_to_export_dpi(3)
            text_bbox = self.draw.textbbox(xy, text, font=font)
            bkgd_color = shape.get('textBackgroundColor', '#00000000')
            r, g, b, a = self.get_rgba_int(bkgd_color)
            a = int(float(shape['textBackgroundOpacity']) * 255)
            rgba_fill = (r, g, b, a)
            box_width = int(text_bbox[2] - text_bbox[0] + 2 * txt_offset)
            box_height = int(text_bbox[3] - text_bbox[1] + 2 * txt_offset)
            box_x = int(text_bbox[0] - txt_offset)
            box_y = int(text_bbox[1] - txt_offset)
            temp_image = Image.new('RGBA', (box_width, box_height))
            temp_draw = ImageDraw.Draw(temp_image)
            temp_draw.rectangle((0, 0, box_width, box_height), fill=rgba_fill)
            self.pil_img.paste(temp_image, (box_x, box_y), mask=temp_image)

        # draw text
        self.draw.text(xy, text, fill=rgba, font=font)

    def draw_arrow(self, shape):

        start = self.get_panel_coords(shape['x1'], shape['y1'])
        end = self.get_panel_coords(shape['x2'], shape['y2'])
        x1 = start['x']
        y1 = start['y']
        x2 = end['x']
        y2 = end['y']
        head_size = ((float(shape.get('strokeWidth', 1)) * 4) + 5)
        head_size = scale_to_export_dpi(head_size)
        stroke_width = scale_to_export_dpi(float(shape.get('strokeWidth', 2)))
        rgb = ShapeToPdfExport.get_rgb(shape['strokeColor'])

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
        self.draw_shape_label(shape, Bounds((x1, y1), (x2, y2)))

    # Override to not just call draw_polygon, because we want square corners
    # for rectangles and not the rounded corners draw_polygon creates
    def draw_rectangle(self, shape):
        points = [
            (shape['x'], shape['y']),
            (shape['x'] + shape['width'], shape['y']),
            (shape['x'] + shape['width'], shape['y'] + shape['height']),
            (shape['x'], shape['y'] + shape['height']),
        ]
        p = []
        if shape.get('rotation', 0) != 0:
            rotation = shape.get('rotation')
            # rotate around centre of rectangle
            cx = shape['x'] + shape['width'] / 2
            cy = shape['y'] + shape['height'] / 2
            points = [
                self.apply_rotation(point, [cx, cy], rotation)
                for point in points
            ]
        t = shape.get('transform')
        for point in points:
            transformed = self.apply_transform(t, point)
            coords = self.get_panel_coords(*transformed)
            p.append((coords['x'], coords['y']))
        p.append(p[0])
        points = p

        stroke_width = scale_to_export_dpi(float(shape.get('strokeWidth', 2)))
        buffer = int(ceil(stroke_width) * 1.5)

        # if fill, draw filled polygon without outline, then add line later
        # with correct stroke width
        r, g, b, a = self.get_rgba_int(shape.get('fillColor', '#00000000'))
        if 'fillOpacity' in shape:
            a = int(float(shape['fillOpacity']) * 255)
        rgba = (r, g, b, a)

        # need to draw on separate image and then paste on to get transparency
        bounds = Bounds(*points).round()
        offset = (bounds.minx, bounds.miny)
        points = [
            (point[0] - offset[0] + buffer, point[1] - offset[1] + buffer)
            for point in points
        ]
        bounds.grow(buffer)
        temp_image = Image.new('RGBA', bounds.get_size())
        temp_draw = ImageDraw.Draw(temp_image)

        # if fill color, draw polygon without outline first
        if rgba[3]:
            temp_draw.polygon(points, fill=rgba, outline=(0, 0, 0, 0))

        def extend_line(p0, p1, pixels):
            dx = p1[0] - p0[0]
            dy = p1[1] - p0[1]
            d = sqrt(dx * dx + dy * dy)
            return (
                p0,
                (p1[0] + dx * pixels / d, p1[1] + dy * pixels / d)
            )

        # Draw all the lines (NB: polygon doesn't handle line width)
        rgba = self.get_rgba_int(shape['strokeColor'])
        width = int(round(stroke_width))
        for i in range(4):
            # extend each line a little bit to fill in the corners
            line = extend_line(points[i], points[i + 1], width / 2)
            temp_draw.line(line, fill=rgba, width=width)

        self.pil_img.paste(
            temp_image, (bounds.minx, bounds.miny), mask=temp_image)
        self.draw_shape_label(shape, bounds)

    def draw_polygon(self, shape, closed=True):
        points = []
        for point in shape['points'].split(" "):
            # Older polygons/polylines may be 'x,y,'
            xy = point.split(",")
            x = xy[0]
            y = xy[1]
            coords = self.get_panel_coords(float(x), float(y))
            points.append((coords['x'], coords['y']))

        if closed:
            points.append(points[0])

        stroke_width = scale_to_export_dpi(float(shape.get('strokeWidth', 2)))
        buffer = int(ceil(stroke_width))

        # if fill, draw filled polygon without outline, then add line later
        # with correct stroke width
        r, g, b, a = self.get_rgba_int(shape.get('fillColor', '#00000000'))
        if 'fillOpacity' in shape:
            a = int(float(shape['fillOpacity']) * 255)
        rgba = (r, g, b, a)

        # need to draw on separate image and then paste on to get transparency
        bounds = Bounds(*points).round()
        offset = (bounds.minx, bounds.miny)
        points = [
            (point[0] - offset[0] + buffer, point[1] - offset[1] + buffer)
            for point in points
        ]
        bounds.grow(buffer)
        temp_image = Image.new('RGBA', bounds.get_size())
        temp_draw = ImageDraw.Draw(temp_image)

        # if fill color, draw polygon without outline first
        if closed and rgba[3]:
            temp_draw.polygon(points, fill=rgba, outline=(0, 0, 0, 0))

        # Draw all the lines (NB: polygon doesn't handle line width)
        rgba = self.get_rgba_int(shape['strokeColor'])
        temp_draw.line(points, fill=rgba, width=int(round(stroke_width)))
        # Draw ellipse at each corner
        # see https://stackoverflow.com/questions/33187698/
        r = (stroke_width / 2) * 0.9  # seems to look OK with this size
        if closed:
            corners = points[:]
        else:
            corners = points[1: -1]
        for point in corners:
            temp_draw.ellipse((point[0] - r, point[1] - r,
                               point[0] + r, point[1] + r), fill=rgba)

        self.pil_img.paste(
            temp_image, (bounds.minx, bounds.miny), mask=temp_image)
        self.draw_shape_label(shape, bounds)

    def draw_polyline(self, shape):
        self.draw_polygon(shape, False)

    def draw_line(self, shape):
        start = self.get_panel_coords(shape['x1'], shape['y1'])
        end = self.get_panel_coords(shape['x2'], shape['y2'])
        x1 = start['x']
        y1 = start['y']
        x2 = end['x']
        y2 = end['y']
        stroke_width = scale_to_export_dpi(float(shape.get('strokeWidth', 2)))
        rgba = ShapeToPdfExport.get_rgba_int(shape['strokeColor'])
        self.draw.line(
            [(x1, y1), (x2, y2)], fill=rgba, width=int(stroke_width))
        self.draw_shape_label(shape, Bounds((x1, y1), (x2, y2)))

    def draw_ellipse(self, shape):

        w = int(scale_to_export_dpi(float(shape.get('strokeWidth', 2))))
        ctr = self.get_panel_coords(shape['x'], shape['y'])
        cx = ctr['x']
        cy = ctr['y']
        rx = self.scale * shape['radiusX']
        ry = self.scale * shape['radiusY']

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

        width = int((rx * 2) + w)
        height = int((ry * 2) + w)
        temp_ellipse = Image.new('RGBA', (width + 1, height + 1),
                                 (255, 255, 255, 0))
        ellipse_draw = ImageDraw.Draw(temp_ellipse)
        # Draw outer ellipse, then remove inner ellipse with full opacity
        rgba = ShapeToPdfExport.get_rgba_int(shape['strokeColor'])
        ellipse_draw.ellipse((0, 0, width, height), fill=rgba)

        r, g, b, a = self.get_rgba_int(shape.get('fillColor', '#00000000'))
        if 'fillOpacity' in shape:
            a = int(float(shape['fillOpacity']) * 255)
        rgba = (r, g, b, a)

        # when rx is ~zero (for a Point, scaled down) don't need inner ellipse
        if (width - w) >= w:
            ellipse_draw.ellipse((w, w, width - w, height - w), fill=rgba)
        temp_ellipse = temp_ellipse.rotate(rotation, resample=Image.BICUBIC,
                                           expand=True)
        # Use ellipse as mask, so transparent part is not pasted
        paste_x = cx - (temp_ellipse.size[0] / 2)
        paste_y = cy - (temp_ellipse.size[1] / 2)
        self.pil_img.paste(temp_ellipse, (int(paste_x), int(paste_y)),
                           mask=temp_ellipse)
        self.draw_shape_label(shape, Bounds((cx, cy)))


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
        try:
            # Since unicode can't be wrapped by rstring, py2
            figure_json_string = figure_json_string.decode('utf8')
        except AttributeError:
            # python 3
            pass
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

    def get_zip_name(self):

        name = self.figure_name
        # in case we have path/to/name.pdf, just use name.pdf
        name = path.basename(name)
        # Remove commas: causes problems 'duplicate headers' in file download
        name = name.replace(",", ".")
        return "%s.zip" % name

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

        name = self.figure_name
        # in case we have path/to/name, just use name
        name = path.basename(name)

        # if ends with E.g. .pdf, remove extension
        if name.endswith("." + fext):
            name = name[0: -len("." + fext)]

        # Name with extension and folder
        full_name = "%s.%s" % (name, fext)
        # Remove commas: causes problems 'duplicate headers' in file download
        full_name = full_name.replace(",", ".")

        index = page if page is not None else 1
        if fext == "tiff" and self.page_count > 1:
            full_name = "%s_page_%02d.%s" % (name, index, fext)
        if self.zip_folder_name is not None:
            full_name = os.path.join(self.zip_folder_name, full_name)

        while os.path.exists(full_name):
            index += 1
            full_name = "%s_page_%02d.%s" % (name, index, fext)
            if self.zip_folder_name is not None:
                full_name = os.path.join(self.zip_folder_name, full_name)

        # Handy to know what the last created file is:
        self.figure_file_name = full_name

        return full_name

    def build_figure(self):
        """
        The main building of the figure happens here, independently of format.
        We set up directories as needed, call create_figure() to create
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
                          int(self.figure_json['page_col_count']) or 1)

        # Create a zip if we have multiple TIFF pages or we're exporting Images
        export_option = self.script_params['Export_Option']
        create_zip = False
        if self.export_images:
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
                self.add_read_me_file()

        # Create the figure file(s)
        self.create_figure()

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

            self.add_page_color()

            px = col * (self.page_width + paper_spacing)
            py = row * (self.page_height + paper_spacing)
            page = {'x': px, 'y': py}

            self.add_panels_to_page(panels_json, image_ids, page)

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

        # PDF will get created in this group
        if group_id is None:
            group_id = self.conn.getEventContext().groupId
        self.conn.SERVICE_OPTS.setOmeroGroup(group_id)

        return self.create_file_annotation(image_ids)

    def create_file_annotation(self, image_ids):
        output_file = self.figure_file_name
        ns = self.ns
        mimetype = self.mimetype

        if self.zip_folder_name is not None:
            zip_name = self.get_zip_name()
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
            link = ImageAnnotationLinkI()
            link.parent = ImageI(iid, False)
            link.child = file_ann._obj
            links.append(link)
        if len(links) > 0:
            # Don't want to fail at this point due to strange permissions combo
            try:
                links = self.conn.getUpdateService().saveAndReturnArray(
                    links, self.conn.SERVICE_OPTS)
            except Exception:
                logger.error("Failed to attach figure: %s to images %s"
                             % (file_ann, image_ids))

        return file_ann

    def apply_rdefs(self, image, channels):
        """ Apply the channel levels and colors to the image """
        c_idxs = []
        windows = []
        colors = []
        reverses = []

        # OMERO.figure doesn't support greyscale rendering
        image.setColorRenderingModel()

        for i, c in enumerate(channels):
            if c['active']:
                c_idxs.append(i + 1)
                windows.append([c['window']['start'], c['window']['end']])
                colors.append(c['color'])
                reverses.append(c.get('reverseIntensity', False))

        image.setActiveChannels(c_idxs, windows, colors, reverses)

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

        viewport_region = self.get_crop_region(panel)

        # Handle page offsets
        x = x - page['x']
        y = y - page['y']

        spacer = 5

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

                elif prop_nf[0] == "dataset":
                    format = prop_nf[1] if len(prop_nf) > 1 else "name"
                    if format == "name":
                        if panel['datasetName']:
                            label_value = panel['datasetName']
                        else:
                            label_value = "No/Many Datasets"
                    elif format == "id":
                        if panel['datasetId']:
                            label_value = str(panel['datasetId'])
                        else:
                            label_value = "null"
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
                ly = y
                labels.reverse()
                for label in labels:
                    ly = ly - label['size'] - spacer
                    draw_lab(label, lx, ly, align='center')
            elif key == 'bottom':
                lx = x + (width / 2)
                ly = y + height + spacer
                for label in labels:
                    label_h = draw_lab(label, lx, ly, align='center')
                    ly += label_h + spacer
            elif key == 'left':
                lx = x - spacer
                sizes = [label['size'] for label in labels]
                total_h = sum(sizes) + spacer * (len(labels) - 1)
                ly = y + (height - total_h) / 2
                for label in labels:
                    label_h = draw_lab(label, lx, ly, align='right')
                    ly += label_h + spacer
            elif key == 'right':
                lx = x + width + spacer
                sizes = [label['size'] for label in labels]
                total_h = sum(sizes) + spacer * (len(labels) - 1)
                ly = y + (height - total_h) / 2
                for label in labels:
                    label_h = draw_lab(label, lx, ly)
                    ly += label_h + spacer
            elif key == 'leftvert':
                lx = x - spacer
                ly = y + (height / 2)
                labels.reverse()
                for label in labels:
                    lx = lx - label['size'] - spacer
                    draw_lab(label, lx, ly, align='left-vertical')
            elif key == 'rightvert':
                lx = x + width + spacer
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

        spacer = 0.05 * max(height, width)

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
        Return the 256 1D array of the LUT from the server or
        the color gradient.

        LUT files on the server are read with the script service, and
        file content is parsed with a custom implementation.
        """
        color = channel["color"]

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

        else:
            script_service = self.conn.getScriptService()
            luts = script_service.getScriptsByMimetype("text/x-lut")
            self.conn.SERVICE_OPTS.setOmeroGroup(  # required to get LUT files
                self.conn.getEventContext().groupId)
            for lut in luts:
                if lut.name.val != color:
                    continue

                orig_file = self.conn.getObject(
                    "OriginalFile", lut.getId()._val)
                lut_data = bytearray()
                # Collect the LUT data in byte form
                for chunk in orig_file.getFileInChunks():
                    lut_data.extend(chunk)

                if len(lut_data) in [768, 800]:
                    lut_arr = numpy.array(lut_data, dtype="uint8")[-768:]
                    color_ramp = lut_arr.reshape(3, 256).T
                else:
                    lut_data = lut_data.decode()
                    r, g, b = [], [], []

                    lines = lut_data.split("\n")
                    sep = None
                    if "\t" in lines[0]:
                        sep = "\t"
                    for line in lines:
                        val = line.split(sep)
                        if len(val) < 3 or not val[-1].isnumeric():
                            continue
                        r.append(int(val[-3]))
                        g.append(int(val[-2]))
                        b.append(int(val[-1]))
                    color_ramp = numpy.array([r, g, b], dtype=numpy.uint8).T
                break

            # Set back the group to -1 to make sure we can find all images
            self.conn.SERVICE_OPTS.setOmeroGroup(-1)

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

    def is_big_image(self, image):
        """Return True if this is a 'big' tiled image."""
        max_w, max_h = self.conn.getMaxPlaneSize()
        return image.getSizeX() * image.getSizeY() > max_w * max_h

    def get_zoom_level_scale(self, image, region, max_width):
        """Calculate the scale and zoom level we want to use for big image."""
        width = region['width']
        height = region['height']

        zm_levels = image.getZoomLevelScaling()
        # e.g. {0: 1.0, 1: 0.25, 2: 0.0625, 3: 0.03123, 4: 0.01440}
        # Pick zoom such that returned image is below MAX size
        max_level = len(zm_levels.keys()) - 1
        # Maximum size that the rendering engine will render
        max_sizes = self.conn.getMaxPlaneSize()

        # start big, and go until we reach target size
        zm = 0
        max_plane = max_sizes[0] * max_sizes[1]
        while (zm < max_level and
               zm_levels[zm] * width > max_width or
               zm_levels[zm] * width * zm_levels[zm] * height > max_plane):
            zm = zm + 1

        level = max_level - zm

        # We need to use final rendered jpeg coordinates
        # Convert from original image coordinates by scaling
        scale = zm_levels[zm]
        return scale, level

    def render_big_image_region(self, image, panel, z, t, region, max_width):
        """
        Render region of a big image at an appropriate zoom level
        so width < max_width
        """
        scale, level = self.get_zoom_level_scale(image, region, max_width)
        # cache the 'zoom_level_scale', in the panel dict.
        # since we need it for scalebar, and don't want to calculate again
        # since rendering engine will be closed by then
        panel['zoom_level_scale'] = scale

        width = region['width']
        height = region['height']
        x = region['x']
        y = region['y']
        size_x = image.getSizeX()
        size_y = image.getSizeY()
        x = int(x * scale)
        y = int(y * scale)
        width = int(width * scale)
        height = int(height * scale)
        size_x = int(size_x * scale)
        size_y = int(size_y * scale)

        canvas = None
        # Coordinates below are all final jpeg coordinates & sizes
        if x < 0 or y < 0 or (x + width) > size_x or (y + height) > size_y:
            # If we're outside the bounds of the image...
            # Need to render reduced region and paste on to full size image
            canvas = Image.new("RGBA", (width, height), (221, 221, 221))
            paste_x = 0
            paste_y = 0
            if x < 0:
                paste_x = -x
                width = width + x
                x = 0
            if y < 0:
                paste_y = -y
                height = height + y
                y = 0

        # Render the region...
        jpeg_data = image.renderJpegRegion(z, t, x, y, width, height,
                                           level=level)
        if jpeg_data is None:
            return

        i = BytesIO(jpeg_data)
        pil_img = Image.open(i)

        # paste to canvas if needed
        if canvas is not None:
            canvas.paste(pil_img, (paste_x, paste_y))
            pil_img = canvas

        return pil_img

    def get_panel_big_image(self, image, panel):
        """Render the viewport region for BIG images"""

        viewport_region = self.get_crop_region(panel)
        rotation = int(panel.get('rotation', 0))
        vp_x = viewport_region['x']
        vp_y = viewport_region['y']
        vp_w = viewport_region['width']
        vp_h = viewport_region['height']
        z = panel['theZ']
        t = panel['theT']

        # E.g. target is 300 dpi and width & height is '72 dpi'
        # so we need image to be width * dpi/72 pixels
        max_dpi = panel.get('max_export_dpi', 1000)
        max_width = (panel['width'] * max_dpi) / 72

        # Render a larger region than viewport, to allow for rotation...
        if rotation != 0:
            max_length = 1.5 * max(vp_w, vp_h)
            extra_w = max_length - vp_w
            extra_h = max_length - vp_h
            viewport_region = {'x': vp_x - (extra_w / 2),
                               'y': vp_y - (extra_h / 2),
                               'width': vp_w + extra_w,
                               'height': vp_h + extra_h}
            max_width = max_width * (viewport_region['width'] / vp_w)

        pil_img = self.render_big_image_region(image, panel, z, t,
                                               viewport_region, max_width)

        # Optional rotation
        if rotation != 0 and pil_img is not None:
            w, h = pil_img.size
            # How much smaller is the scaled image compared to viewport?
            # This will be the same 'scale' used in render_big_image_region()
            scale = panel['zoom_level_scale']
            # The size we want to crop to
            crop_target_w = scale * vp_w
            crop_target_h = scale * vp_h

            # Now we can rotate...
            pil_img = pil_img.rotate(-rotation, Image.BICUBIC, expand=1)
            rot_w, rot_h = pil_img.size

            # ...and crop all round (keep same centre point)
            crop_left = int((rot_w - crop_target_w) / 2)
            crop_top = int((rot_h - crop_target_h) / 2)
            crop_right = rot_w - crop_left
            crop_bottom = rot_h - crop_top

            pil_img = pil_img.crop((crop_left, crop_top,
                                    crop_right, crop_bottom))

        return pil_img

    def get_panel_image(self, image, panel, orig_name=None):
        """
        Gets the rendered image from OMERO, then crops & rotates as needed.
        Optionally saving original and cropped images as TIFFs.
        Returns image as PIL image.
        """
        z = panel['theZ']
        t = panel['theT']
        size_x = image.getSizeX()
        size_y = image.getSizeY()
        size_z = image.getSizeZ()
        size_c = image.getSizeC()

        if 'z_projection' in panel and panel['z_projection']:
            if 'z_start' in panel and 'z_end' in panel:
                # check max_projection_bytes
                pixel_range = image.getPixelRange()
                bytes_per_pixel = ceil(log2(pixel_range[1]) / 8.0)
                proj_bytes = (size_z * size_x * size_y
                              * size_c * bytes_per_pixel)

                cfg = self.conn.getConfigService()
                max_bytes = int(cfg.getConfigValue(
                    'omero.pixeldata.max_projection_bytes'))

                if proj_bytes <= max_bytes:
                    image.setProjection('intmax')
                    image.setProjectionRange(panel['z_start'], panel['z_end'])
                else:
                    print(f'projected_bytes {proj_bytes} exceeds '
                          f'MAX_PROJECTED_BYTES limit: {max_bytes}')
                    # Turn off all channels to render a black panel
                    image.setActiveChannels([])

        # If big image, we don't want to render the whole plane
        if self.is_big_image(image):
            pil_img = self.get_panel_big_image(image, panel)
        else:
            pil_img = image.renderImage(z, t, compression=1.0)

        if pil_img is None:
            return

        if orig_name is not None:
            pil_img.save(orig_name)

        # big image will already be cropped...
        if self.is_big_image(image):
            return pil_img

        # Need to crop around centre before rotating...
        cx = size_x / 2
        cy = size_y / 2
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
        if 'rotation' in panel and panel['rotation'] > 0:
            rotation = -int(panel['rotation'])
            pil_img = pil_img.rotate(rotation, Image.BICUBIC)

        # Final crop to size
        panel_size = self.get_crop_region(panel)

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

    def draw_panel(self, panel, page, idx):
        """
        Gets the image from OMERO, processes (and saves) it then
        calls self.paste_image() to add it to PDF or TIFF figure.
        """
        image_id = panel['imageId']
        channels = panel['channels']

        image = self.conn.getObject("Image", image_id)
        if image is None:
            return None, None

        try:
            self.apply_rdefs(image, channels)

            # create name to save image
            original_name = image.getName()
            img_name = os.path.basename(original_name)
            img_name = "%s_%s.tiff" % (idx, img_name)

            # get cropped image (saving original)
            orig_name = None
            if self.export_images:
                orig_name = os.path.join(
                    self.zip_folder_name, ORIGINAL_DIR, img_name)
            pil_img = self.get_panel_image(image, panel, orig_name)
        finally:
            if image._re is not None:
                image._re.close()

        # for PDF export, we might have a target dpi
        dpi = panel.get('min_export_dpi', None)

        # Paste the panel to PDF or TIFF image
        self.paste_image(pil_img, img_name, panel, page, dpi)

        return image, pil_img

    def get_thumbnail(self, image_id):
        """ Saves thumb as local jpg and returns name """

        conn = self.conn
        image = conn.getObject("Image", image_id)
        if image is None:
            return
        thumb_data = image.getThumbnail(size=(96, 96))
        i = BytesIO(thumb_data)
        pil_img = Image.open(i)
        temp_name = str(image_id) + "thumb.jpg"
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

    def add_read_me_file(self):
        """ Add a simple text file into the zip to explain what's there """
        read_me_path = os.path.join(self.zip_folder_name, "README.txt")
        with open(read_me_path, 'w') as f:
            f.write(README_TXT)

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
        for p in panels_json:
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
            thumb_src = self.get_thumbnail(iid)
            # thumb = "<img src='%s' width='%s' height='%s' " \
            #         "valign='middle' />" % (thumbSrc, thumbSize, thumbSize)
            lines = []
            lines.append(p['name'])
            img_url = "%s?show=image-%s" % (base_url, iid)
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

    def add_panels_to_page(self, panels_json, image_ids, page):
        """ Add panels that are within the bounds of this page """
        for i, panel in enumerate(panels_json):

            if not self.panel_is_on_page(panel, page):
                continue

            image_id = panel['imageId']
            # draw_panel() creates PIL image then applies it to the page.
            # For TIFF export, draw_panel() also adds shapes to the
            # PIL image before pasting onto the page...
            image, pil_img = self.draw_panel(panel, page, i)
            if image is None:
                continue
            if image.canAnnotate():
                image_ids.add(image_id)
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
                if self.export_images:
                    # Save image BEFORE resampling
                    rs_name = os.path.join(
                        self.zip_folder_name, RESAMPLED_DIR, img_name)
                    pil_img.save(rs_name)
                pil_img = pil_img.resize((target_w, target_h), Image.BICUBIC)

        # in the folder to zip
        if self.zip_folder_name is not None:
            img_name = os.path.join(self.zip_folder_name, FINAL_DIR, img_name)

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

        self.ns = "omero.web.figure.tiff"
        self.mimetype = "image/tiff"

    def add_rois(self, panel, page):
        """ TIFF export doesn't add ROIs to page (does it to panel)"""
        pass

    def get_font(self, fontsize, bold=False, italics=False):
        """ Try to load font from known location in OMERO """
        font_name = "FreeSans.ttf"
        if bold and italics:
            font_name = "FreeSansBoldOblique.ttf"
        elif bold:
            font_name = "FreeSansBold.ttf"
        elif italics:
            font_name = "FreeSansOblique.ttf"
        path_to_font = os.path.join(self.GATEWAYPATH, "pilfonts", font_name)
        try:
            font = ImageFont.truetype(path_to_font, fontsize)
        except Exception:
            font = ImageFont.load(
                '%s/pilfonts/B%0.2d.pil' % (self.GATEWAYPATH, 24))
        return font

    def get_figure_file_ext(self):
        return "tiff"

    def create_figure(self):
        """
        Creates a new PIL image ready to receive panels, labels etc.
        This is created for each page in the figure.
        """
        tiff_width = int(scale_to_export_dpi(self.page_width))
        tiff_height = int(scale_to_export_dpi(self.page_height))
        rgb = (255, 255, 255)
        page_color = self.figure_json.get('page_color')
        if page_color is not None:
            rgb = ShapeToPdfExport.get_rgb('#' + page_color)
        self.tiff_figure = Image.new("RGBA", (tiff_width, tiff_height), rgb)

    def add_page_color(self):
        """ Don't need to do anything for TIFF. Image is already colored."""
        pass

    def paste_image(self, pil_img, img_name, panel, page,
                    dpi=None, is_colorbar=False):
        """ Add the PIL image to the current figure page """

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

        x2 = scale_to_export_dpi(x + width)
        y2 = scale_to_export_dpi(y + height)
        x = scale_to_export_dpi(x)
        y = scale_to_export_dpi(y)
        width = x2 - x
        height = y2 - y

        export_img = self.export_images and not is_colorbar
        # Save image BEFORE resampling
        if export_img:
            rs_name = os.path.join(self.zip_folder_name, RESAMPLED_DIR,
                                   img_name)
            pil_img.save(rs_name)

        # Resize to our target size to match DPI of figure
        pil_img = pil_img.resize((width, height), Image.BICUBIC)

        if export_img:
            img_name = os.path.join(self.zip_folder_name, FINAL_DIR, img_name)
            pil_img.save(img_name)

        # Now at full figure resolution - Good time to add shapes...
        crop = self.get_crop_region(panel)
        exporter = ShapeToPilExport(pil_img, panel, crop)

        width, height = pil_img.size

        # Add border if needed - Rectangle around the whole panel
        if 'border' in panel and panel['border'].get('showBorder'):
            sw = panel['border'].get('strokeWidth')
            border_width = int(round(scale_to_export_dpi(sw)))
            border_color = panel['border'].get('color')
            padding = border_width * 2

            canvas = Image.new("RGB", (width + padding, height + padding),
                               exporter.get_rgb(border_color))
            canvas.paste(pil_img, (border_width, border_width))
            pil_img = canvas
            box = (x - border_width,
                   y - border_width,
                   x + width + border_width,
                   y + height + border_width)
        else:
            box = (x, y, x + width, y + height)

        self.tiff_figure.paste(pil_img, box)

    def draw_scalebar_line(self, x, y, x2, y2, width, rgb):
        """ Draw line on the current figure page """
        draw = ImageDraw.Draw(self.tiff_figure)

        x = scale_to_export_dpi(x)
        y = scale_to_export_dpi(y)
        x2 = scale_to_export_dpi(x2)
        y2 = scale_to_export_dpi(y2)
        width = scale_to_export_dpi(width)

        x, x2 = (x2, x) if x > x2 else (x, x2)
        y, y2 = (y2, y) if y > y2 else (y, y2)

        # the coordinates are included in the line
        draw.line([(x, y), (x2, y2)], fill=rgb, width=width)

    def draw_temp_label(self, text, fontsize, rgb):
        """Returns a new PIL image with text. Handles html."""
        tokens = self.parse_html(text)

        widths = []
        heights = []
        for t in tokens:
            font = self.get_font(fontsize, t['bold'], t['italics'])
            box = font.getbbox(t['text'])
            txt_w = box[2] - box[0]
            txt_h = box[3] - box[1]
            widths.append(txt_w)
            heights.append(txt_h)

        label_w = sum(widths)
        label_h = max(heights)

        temp_label = Image.new('RGBA', (label_w, label_h), (255, 255, 255, 0))
        textdraw = ImageDraw.Draw(temp_label)

        w = 0
        for t in tokens:
            font = self.get_font(fontsize, t['bold'], t['italics'])
            box = font.getbbox(t['text'])
            txt_w = box[2] - box[0]
            txt_h = box[3] - box[1]
            textdraw.text((w, -box[1]), t['text'], font=font, fill=rgb)
            w += txt_w
        return temp_label

    def draw_colorbar_ticks(self, colorbar, ramp_d, labels,
                            labels_x, labels_y):
        """ Draw colorbar spine and ticks on the current figure page """

        fontsize = int(colorbar["font_size"])
        mark_len = colorbar["mark_len"]
        tick_margin = colorbar["tick_margin"]
        pos = colorbar["position"]
        tick_thickness = colorbar.get("tick_thickness", 1)
        rgb = colorbar["axis_color"]
        rgb = tuple(int(rgb[i:i+2], 16) for i in (0, 2, 4))

        align = ramp_d["align"]

        # Drawing of the ticks (line + label)
        draw = ImageDraw.Draw(self.tiff_figure)
        tick_thick_px = scale_to_export_dpi(tick_thickness)
        for label, pos_x, pos_y in zip(labels, labels_x, labels_y):
            # Cosmetic correction flag for first and last label
            shift = 0
            if label == labels[0]:
                shift = -1
            elif label == labels[-1]:
                shift = 1

            if pos in ["left", "right"]:
                x1 = pos_x
                y1 = pos_y
                y2 = pos_y
                y_txt = pos_y - fontsize / 2 + 0.5

                if pos == "left":
                    x2 = pos_x - mark_len
                    x_txt = pos_x - mark_len - tick_margin
                    x1, x2 = x2, x1
                else:
                    x2 = pos_x + mark_len
                    x_txt = pos_x + mark_len + tick_margin

            elif pos in ["top", "bottom"]:
                x1 = pos_x
                x2 = pos_x
                y1 = pos_y
                x_txt = pos_x
                if pos == "top":
                    y2 = pos_y - mark_len
                    y_txt = pos_y - fontsize - mark_len - tick_margin
                    y1, y2 = y2, y1
                else:
                    y2 = pos_y + mark_len
                    y_txt = pos_y + mark_len + tick_margin

            x1 = scale_to_export_dpi(x1)
            y1 = scale_to_export_dpi(y1)
            x2 = scale_to_export_dpi(x2)
            y2 = scale_to_export_dpi(y2)

            offset = 1  # Centering the marks
            offset += int(tick_thick_px/2) * shift  # first or last label
            if pos in ["left", "right"]:
                x2 -= 1  # x2/y2 are included in the line, remove last pixel
                y1, y2 = y1 - offset, y2 - offset
                y_txt -= tick_thickness / 2 * shift
            elif pos in ["top", "bottom"]:
                y2 -= 1
                x1, x2 = x1 - offset, x2 - offset
                x_txt -= tick_thickness / 2 * shift

            if mark_len > 0:  # Do not add empty elements
                # the coordinates are included in the line
                draw.line([(x1, y1), (x2, y2)],
                          fill=rgb, width=tick_thick_px)

            self.draw_text(label, x_txt, y_txt, fontsize, rgb, align=align)

        # Draw colorbar spine
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

        x1 = scale_to_export_dpi(x1)
        y1 = scale_to_export_dpi(y1)
        x2 = scale_to_export_dpi(x2)
        y2 = scale_to_export_dpi(y2)
        # x2/y2 are included in the line, need to remove 'last pixel'
        if pos in ["left", "right"]:
            y2 -= 1
            x1, x2 = x1 - 1, x2 - 1
        elif pos in ["top", "bottom"]:
            x2 -= 1
            y1, y2 = y1 - 1, y2 - 1
        draw.line([(x1, y1), (x2, y2)], fill=rgb, width=tick_thick_px)

    def parse_html(self, html):
        """
        Parse html to give list of tokens with bold or italics

        Returns list of [{'text': txt, 'bold': true, 'italics': false}]
        """
        in_bold = False
        in_italics = False

        # Remove any <p> tags
        html = html.replace('<p>', '')
        html = html.replace('</p>', '')

        tokens = []
        token = ""
        i = 0
        while i < len(html):
            # look for start / end of b or i elements
            start_bold = html[i:].startswith("<strong>")
            end_bold = html[i:].startswith("</strong>")
            start_ital = html[i:].startswith("<em>")
            end_ital = html[i:].startswith("</em>")

            if start_bold:
                i += len("<strong>")
            elif end_bold:
                i += len("</strong>")
            elif start_ital:
                i += len("<em>")
            elif end_ital:
                i += len("</em>")

            # if style has changed:
            if start_bold or end_bold or start_ital or end_ital:
                # save token with previous style
                tokens.append({'text': token, 'bold': in_bold,
                               'italics': in_italics})
                token = ""
                if start_bold or end_bold:
                    in_bold = start_bold
                elif start_ital or end_ital:
                    in_italics = start_ital
            else:
                token = token + html[i]
                i += 1
        tokens.append({'text': token, 'bold': in_bold, 'italics': in_italics})
        return tokens

    def draw_text(self, text, x, y, fontsize, rgb, align="center"):
        """ Add text to the current figure page """
        x = scale_to_export_dpi(x)
        y = scale_to_export_dpi(y)
        fontsize = scale_to_export_dpi(fontsize)

        if markdown_imported:
            # convert markdown to html
            text = markdown.markdown(text)

        temp_label = self.draw_temp_label(text, fontsize, rgb)

        if align == "left-vertical":
            temp_label = temp_label.rotate(90, expand=True)
            y = y - (temp_label.size[1] / 2)
        elif align == "right-vertical":
            temp_label = temp_label.rotate(-90, expand=True)
            y = y - (temp_label.size[1] / 2)
            x = x - temp_label.size[0]
        elif align == "center":
            x = x - (temp_label.size[0] / 2)
        elif align == "right":
            x = x - temp_label.size[0]

        if align not in ["left-vertical", "right-vertical"]:
            # The text in TIFF is higher compared to PDF. Add offset
            y = y + scale_to_export_dpi(1)

        x = int(round(x))
        y = int(round(y))
        # Use label as mask, so transparent part is not pasted
        self.tiff_figure.paste(temp_label, (x, y), mask=temp_label)

    def save_page(self, page=None):
        """
        Save the current PIL image page as a TIFF and start a new
        PIL image for the next page
        """
        self.figure_file_name = self.get_figure_file_name()

        self.tiff_figure.save(self.figure_file_name)

        # Create a new blank tiffFigure for subsequent pages
        self.create_figure()

    def add_info_page(self, panels_json):
        """
        Since we need a PDF for the info page, we create one first,
        then call superclass add_info_page
        """
        # We allow TIFF figure export without reportlab (no Info page)
        if not reportlab_installed:
            return

        full_name = "info_page.pdf"
        if self.zip_folder_name is not None:
            full_name = os.path.join(self.zip_folder_name, full_name)
        self.figure_canvas = canvas.Canvas(
            full_name, pagesize=(self.page_width, self.page_height))

        # Superclass method will call add_para_with_thumb(),
        # to add lines to self.infoLines
        super(TiffExport, self).add_info_page(panels_json)

    def save_figure(self):
        """ Completes PDF figure (or info-page PDF for TIFF export) """
        # We allow TIFF figure export without reportlab (no Info page)
        if not reportlab_installed:
            return
        self.figure_canvas.save()


class OmeroExport(TiffExport):

    def __init__(self, conn, script_params):

        super(OmeroExport, self).__init__(conn, script_params)

        self.new_image = None

    def save_page(self, page=None):
        """
        Save the current PIL image page as a new OMERO image and start a new
        PIL image for the next page
        """
        self.figure_file_name = self.get_figure_file_name(page + 1)

        # Try to get a Dataset
        dataset = None
        for panel in self.figure_json['panels']:
            parent = self.conn.getObject('Image', panel['imageId']).getParent()
            if parent is not None and parent.OMERO_CLASS == 'Dataset':
                if parent.canLink():
                    dataset = parent
                    break

        # Need to specify group for new image
        group_id = self.conn.getEventContext().groupId
        if dataset is not None:
            group_id = dataset.getDetails().group.id.val
            dataset = dataset._obj  # get the omero.model.DatasetI
        self.conn.SERVICE_OPTS.setOmeroGroup(group_id)

        description = "Created from OMERO.figure: "
        url = self.script_params.get("Figure_URI")
        legend = self.figure_json.get('legend')
        if url is not None:
            description += url
        if legend is not None:
            description = "%s\n\n%s" % (description, legend)

        img_ids = set()
        lines = []
        for p in self.figure_json['panels']:
            iid = p['imageId']
            if iid in img_ids:
                continue  # ignore images we've already handled
            img_ids.add(iid)
            lines.append('- Image:%s %s' % (iid, p['name']))
        description += "Contains images:\n%s" % "\n".join(lines)

        np_array = numpy.asarray(self.tiff_figure)
        red = np_array[::, ::, 0]
        green = np_array[::, ::, 1]
        blue = np_array[::, ::, 2]
        plane_gen = iter([red, green, blue])
        self.new_image = self.conn.createImageFromNumpySeq(
            plane_gen,
            self.figure_file_name,
            sizeC=3,
            description=description, dataset=dataset)
        # Reset group context
        self.conn.SERVICE_OPTS.setOmeroGroup(-1)
        # Create a new blank tiffFigure for subsequent pages
        self.create_figure()

    def create_file_annotation(self, image_ids):
        """Return result of script."""

        # We don't need to create file annotation, but we can return
        # the new image, which will be returned from the script
        return self.new_image


def export_figure(conn, script_params):
    # make sure we can find all images
    conn.SERVICE_OPTS.setOmeroGroup(-1)

    export_option = script_params['Export_Option']

    if export_option == 'PDF':
        fig_export = FigureExport(conn, script_params)
    elif export_option == 'PDF_IMAGES':
        fig_export = FigureExport(conn, script_params, export_images=True)
    elif export_option == 'TIFF':
        fig_export = TiffExport(conn, script_params)
    elif export_option == 'TIFF_IMAGES':
        fig_export = TiffExport(conn, script_params, export_images=True)
    elif export_option == 'OMERO':
        fig_export = OmeroExport(conn, script_params)
    return fig_export.build_figure()


def run_script():
    """
    The main entry point of the script, as called by the client
    via the scripting service, passing the required parameters.
    """

    export_options = [rstring('PDF'), rstring('PDF_IMAGES'),
                      rstring('TIFF'), rstring('TIFF_IMAGES'),
                      rstring('OMERO')]

    client = scripts.client(
        'Figure_To_Pdf.py',
        """Used by web.figure to generate pdf figures from json data""",

        scripts.String("Figure_JSON", optional=False,
                       description="All figure info as json stringified"),

        scripts.String("Export_Option", values=export_options,
                       default="PDF"),

        scripts.String("Webclient_URI", optional=False, grouping="4",
                       description="webclient URL for adding links to images"),

        scripts.String("Figure_Name", grouping="4",
                       description="Name of the Pdf Figure"),

        scripts.String("Figure_URI",
                       description="URL to the Figure")
    )

    try:
        script_params = {}

        conn = BlitzGateway(client_obj=client)

        # process the list of args above.
        for key in client.getInputKeys():
            if client.getInput(key):
                script_params[key] = client.getInput(key, unwrap=True)

        # call the main script - returns a file annotation wrapper
        file_annotation = export_figure(conn, script_params)

        # return this file_annotation to the client.
        client.setOutput("Message", rstring("Figure created"))
        if file_annotation is not None:
            client.setOutput(
                "New_Figure",
                robject(file_annotation._obj))

    finally:
        client.closeSession()


if __name__ == "__main__":
    run_script()
