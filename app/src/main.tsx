import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import App from './App'
import DevModeToggle from './components/DevModeToggle'
import { WalletProvider } from './context/WalletContext'
import { queryClient } from './lib/queryClient'
import './globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          <App />
          <DevModeToggle />
          <Toaster richColors theme="system" position="top-right" />
        </WalletProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
)
