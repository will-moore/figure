# To ensure that the gh-pages job doesn't try to build a jekyll site
# (and ignore files in /assets), we create a .nojekyll file in the
# ./gh_pages/ output dir. The pages.yml workflow copies all of that dir
#  to the gh-pages branch.

touch gh_pages/.nojekyll