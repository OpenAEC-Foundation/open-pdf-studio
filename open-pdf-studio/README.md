# OpenPDFStudio

A free, open-source PDF annotation editor built with Electron and PDF.js, featuring a comprehensive ribbon interface.

## Installation

1. Clone or download this repository
2. Navigate to the project directory
3. Install dependencies:
   ```bash
   npm install
   ```

## Running the Application

```bash
npm start
```

## Building

```bash
# Windows
npm run build:win

# Linux
npm run build:linux

# macOS
npm run build:mac

# All platforms
npm run build:all
```

## Project Structure

```
open-pdf-studio/
├── index.html          # Main HTML file with UI
├── main.js             # Electron main process
├── preload.js          # Preload script for IPC
├── js/                 # Application modules
│   ├── main.js         # Entry point
│   ├── core/           # State, constants, preferences
│   ├── annotations/    # Annotation handling
│   ├── pdf/            # PDF loading, rendering, saving
│   ├── tools/          # Tool management
│   ├── ui/             # UI components
│   ├── events/         # Event handlers
│   └── utils/          # Utility functions
├── pdfjs/              # PDF.js library files
├── package.json        # Project configuration
└── README.md           # This file
```

## Technologies Used

- **Electron** - Desktop application framework
- **PDF.js** - PDF rendering engine
- **pdf-lib** - PDF manipulation and saving
- **HTML5 Canvas** - For PDF rendering and annotations
- **JavaScript (ES6 Modules)** - Application logic

## License

MIT

## Links

- **Repository**: https://github.com/OpenAEC-Foundation/OpenPDFStudio
- **Issues**: https://github.com/OpenAEC-Foundation/OpenPDFStudio/issues
