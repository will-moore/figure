
# OME figure

OME figure is a web app for creating publication figures from microscopy images.

As a standalone tool, available at [will-moore.github.io/figure/](https://will-moore.github.io/figure/) it uses [OME-Zarr](https://ngff.openmicroscopy.org/) images, which can be hosted locally or publicly available at any remote URL.

The app is also packaged as an OMERO.web plugin: [omero-figure](https://github.com/ome/omero-figure/), where this `figure` app was originally developed.


# Usage

The workflow for creating figures can be summarised as follows:

 - Your OME-Zarr images need to be hosted at a URL that OME figure can access. If your images are on your local machine, we suggest that you use [FileGlancer](https://github.com/JaneliaSciComp/fileglancer) to serve them. You can use the `Copy link` button to get a URL that can be used in OME figure.

 - Create a new figure at [will-moore.github.io/figure/](https://will-moore.github.io/figure/), then `Add Images` and paste in the URL to your OME-Zarr image(s).

 - Edit your figure. All the features are the same as OMERO.figure and you can find several useful [OMERO.figure tutorials on YouTube](https://www.youtube.com/results?search_query=OMERO.figure).

 - Save your figure. This will allow you to download your figure as a `JSON` file. In the text below, this is called `downloaded_figure.json`.

 - You can open this figure to make further edits with the figure app `File > Open` dialog, and choosing your locally saved file.

 - Export your figure to PDF or TIFF. The python script will read the OME-Zarr images from the specified URLs and generate a figure as a PDF or TIFF, depending on the chosen file extension:

```
    $ pip install ome-figure

    # export to PDF
    $ figure_export downloaded_figure.json my_figure.pdf
    
    # or export to TIFF
    $ figure_export downloaded_figure.json my_figure.tiff
```

## Sharing your figures publicly

If you wish to share your figures publicly (and your OME-Zarr images are already public) then you need to host your `downloaded_figure.json` somewhere.
For GitHub users, you can use [gist.github.com](https://gist.github.com/) to create
a public gist, with a chosen filename. Once created, e.g. [ngff_images_figure.json](https://gist.github.com/will-moore/75a7f0de5be0f7b4202d5f0229cadcc9) you can click the `Raw` link to see the original file, then `Copy` this URL.

In the OME figure app, `File > Open` dialog, paste in this URL and click `Open`.
The app will load the figure and the URL will show `?file=[YOUR URL]`.
You can share the complete figure URL, for example https://will-moore.github.io/figure/?file=https://gist.githubusercontent.com/will-moore/75a7f0de5be0f7b4202d5f0229cadcc9/raw/ngff_images_figure.json 


# Development

We use `vite.js <https://vitejs.dev/>`_ to build and serve the app during development.

Install Node from https://nodejs.org, then:

```
    $ cd omero-figure
    $ npm install
    $ npm run dev     # or npm run start
```

The app will run as a standalone app that can load OME-Zarr images.

The figure app contains some OMERO-specific funtionality that is disabled
by a global variable `APP_SERVED_BY_OMERO` which is `false` in the standalone app.

This is used to determine the behaviour of various features such as File Open/Save
and the figure Export dialog.

If you are editing the Shape-Editor code, you can view the test page at
http://localhost:8080/shapeEditorTest.html


## Deploying the app to GitHub pages

The standalone app is deployed to GitHub pages at https://will-moore.github.io/figure/ via a GitHub action defined in ``.github/workflows/pages.yml`` which acts on push to the `master` branch.
The action then builds the app and pushes the built files to the `gh-pages` branch.

To deploy the app from your own fork, you can push to your own `master` branch and
set up GitHub pages to deploy from the root of your `gh-pages` branch.


# License

figure is currently licensed under the AGPL.

# Copyright

2016-2026, The Open Microscopy Environment
