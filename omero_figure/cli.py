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

import argparse
import os

from omero_figure.scripts.omero.figure_scripts.Figure_To_Pdf \
    import export_figure


def figure_export() -> None:
    parser = argparse.ArgumentParser(
        prog="figure_export",
        description="Export an OMERO Figure file.",
    )
    parser.add_argument("input", type=str, help="Path to the input file")
    parser.add_argument("output", type=str, help="Path to the output file")

    args = parser.parse_args()
    output_path = args.output
    print(f"input:  {args.input}")
    print(f"output: {args.output}")

    if os.path.exists(output_path):
        print(f"Output file {output_path} already exists; Exiting.")
        return

    # open and read the input file
    with open(args.input, 'r') as f:
        figure_json = f.read()

    fext = output_path.split('.')[-1].lower()
    file_type = "TIFF" if fext in ['tif', 'tiff'] else "PDF"

    script_args = {
                    "Figure_JSON": figure_json,
                    "outputPathName": output_path,
                    "Export_Option": file_type,
                    # TODO: Fix URL
                    "Webclient_URI": "http://localhost:8080/"
                }

    export_figure(None, script_args)

    print("Figure export completed.")


if __name__ == "__main__":
    figure_export()
