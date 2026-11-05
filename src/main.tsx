import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadGameFont } from './game/art/fonts';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');

// Wait for the font first: Phaser rasterizes name tags and speech bubbles
// once, and would otherwise keep a fallback font.
void loadGameFont().then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
