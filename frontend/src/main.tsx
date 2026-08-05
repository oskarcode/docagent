// React creates the browser application root and StrictMode highlights unsafe development behavior.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Application code and global styles form the complete frontend bundle.
import { App } from './App.tsx';
import './styles.css';

// The HTML shell provides this root element; React owns everything rendered inside it.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
