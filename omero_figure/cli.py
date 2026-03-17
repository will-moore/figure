import argparse
import sys

from omero_figure.scripts.omero.figure_scripts.Figure_To_Pdf import export_figure

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

    # open and read the input file
    with open(args.input, 'r') as f:
        figureJSON = f.read()

    fext = output_path.split('.')[-1].lower()
    file_type = "TIFF" if fext in ['tif', 'tiff'] else "PDF"

    script_args = {
                    "Figure_JSON": figureJSON,
                    "outputPathName": output_path,
                    "Export_Option": file_type,
                    # TODO: Fix URL
                    "Webclient_URI": "http://localhost:8080/"
                }

    export_figure(None, script_args)

    print("Figure export completed.")


if __name__ == "__main__":
    figure_export()
