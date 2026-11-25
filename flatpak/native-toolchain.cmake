# The SDK defaults to lib64, but tesseract-rs searches <prefix>/lib for the
# static Leptonica/Tesseract libraries it builds. Keep their install layout
# consistent with that contract inside this native Linux build.
set(CMAKE_INSTALL_LIBDIR lib CACHE PATH "Native library install directory" FORCE)
