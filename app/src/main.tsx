import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import App from './App'
import DevModeToggle from './components/DevModeToggle'
import { WalletProvider } from './context/WalletContext'
import './globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <WalletProvider>
        <App />
        <DevModeToggle />
        <Toaster richColors theme="system" position="top-right" />
      </WalletProvider>
    </BrowserRouter>
  </React.StrictMode>
)
