#
# Copyright (c) 2014-2018 University of Dundee.
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
"""OMERO.script to export figures."""

import logging

import omero.scripts as scripts
from omero.gateway import BlitzGateway
from omero.rtypes import rstring, robject
from omero.model import ImageI, ImageAnnotationLinkI
import json

logger = logging.getLogger('figure_to_pdf')

from omero_figure.export import FigureExport, \
                                TiffExport, \
                                OmeroExport

def create_file_annotation(conn, output_file, image_ids):
    """Create a FileAnnotation in OMERO from the local file, link to images."""
    file_ext = output_file.split(".")[-1]
    # get Group for first image
    group_id = conn.getObject("Image", image_ids[0]).getDetails().group.id.val
    conn.SERVICE_OPTS.setOmeroGroup(group_id)

    ns = "omero.web.figure.%s" % file_ext
    if file_ext == 'zip':
        mimetype = "application/zip"
    elif file_ext == 'pdf':
        mimetype = "application/pdf"
    elif file_ext == 'tiff':
        mimetype = "image/tiff"

    file_ann = conn.createFileAnnfromLocalFile(
        output_file,
        mimetype=mimetype,
        ns=ns)

    links = []
    for image in conn.getObjects("Image", image_ids):
        if image.canLink():
            link = ImageAnnotationLinkI()
            link.parent = ImageI(image.id, False)
            link.child = file_ann._obj
            links.append(link)
    if len(links) > 0:
        # Don't want to fail at this point due to strange permissions combo
        try:
            links = conn.getUpdateService().saveAndReturnArray(
                links, conn.SERVICE_OPTS)
        except Exception:
            logger.error("Failed to attach figure: %s to images %s"
                         % (file_ann, image_ids))

    return file_ann


def export_figure(conn, script_params):
    """Main function to perform figure export."""
    # make sure we can find all images
    conn.SERVICE_OPTS.setOmeroGroup(-1)

    export_option = script_params['Export_Option']

    # Since unicode can't be wrapped by rstring - convert to unicode
    figure_json_string = script_params['Figure_JSON']
    figure_json_string = figure_json_string.decode('utf8')
    script_params['Figure_JSON'] = figure_json_string

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

    result = fig_export.build_figure()

    if export_option == 'OMERO':
        # result is a list of new Image IDs
        if len(result) == 0:
            return
        # Return first Image
        return conn.getObject("Image", result[0])

    # result is a file object...
    file_data = result.getvalue()
    result.close()


    file_name = fig_export.get_export_file_name()
    with open(file_name,'wb') as out:
        out.write(file_data)

    # get Image IDs
    figure_json = json.loads(figure_json_string)
    image_ids = [p['imageId'] for p in figure_json['panels']]

    return create_file_annotation(conn, file_name, image_ids)


def run_script():
    """The main entry point of the script, as called by the client."""
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
        obj_wrapper = export_figure(conn, script_params)

        # return this obj_wrapper to the client.
        client.setOutput("Message", rstring("Figure created"))
        if obj_wrapper is not None:
            client.setOutput(
                "New_Figure",
                robject(obj_wrapper._obj))

    finally:
        client.closeSession()


if __name__ == "__main__":
    run_script()
