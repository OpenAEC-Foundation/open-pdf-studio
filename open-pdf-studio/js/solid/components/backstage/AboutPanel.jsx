import { createSignal, onMount } from 'solid-js';
import { getAppVersion, openExternal } from '../../../core/platform.js';

export default function AboutPanel() {
  const [version, setVersion] = createSignal('Version');

  onMount(async () => {
    const v = await getAppVersion();
    if (v) setVersion(`Version ${v}`);
  });

  return (
    <div class="bs-about-panel">
      <h2 class="bs-about-title">About</h2>
      <div class="bs-about-app">
        <div class="bs-about-logo">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#667eea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 2V8H20" stroke="#667eea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 13H8" stroke="#764ba2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 17H8" stroke="#764ba2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 9H9H8" stroke="#764ba2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="bs-about-app-info">
          <h1 class="bs-about-app-name">Open PDF Studio</h1>
          <p class="bs-about-version">{version()}</p>
        </div>
      </div>
      <p class="bs-about-tagline">IT Without Chains</p>
      <p class="bs-about-description">
        A professional PDF editor for viewing, annotating, and editing PDF documents.
        Built with open source technologies.
      </p>
      <div class="bs-about-company">
        <h3 class="bs-about-company-name">OpenAEC Foundation</h3>
        <p class="bs-about-company-desc">
          From the Latin "to share and distribute" - we liberate businesses from vendor lock-in
          through professional open source solutions. Transparent pricing, transparent code.
        </p>
      </div>
      <div class="bs-about-links">
        <a href="#" class="bs-about-link" onClick={(e) => { e.preventDefault(); openExternal('https://impertio.nl/'); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          Website
        </a>
        <a href="#" class="bs-about-link" onClick={(e) => { e.preventDefault(); openExternal('mailto:maarten@impertio.nl'); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          Contact
        </a>
      </div>
      <div class="bs-about-footer">
        <p class="bs-about-copyright">&copy; 2025 OpenAEC Foundation. Licensed under MIT.</p>
      </div>
    </div>
  );
}
