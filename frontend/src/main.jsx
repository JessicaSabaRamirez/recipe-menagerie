import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { GoogleOAuthProvider } from '@react-oauth/google';

// PASTE YOUR GOOGLE CLIENT ID HERE (The one ending in .apps.googleusercontent.com)
const CLIENT_ID = "964126115948-gkpjsged4sbd1mmfsrr0u15v0c9sg0s5.apps.googleusercontent.com";

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </React.StrictMode>,
)