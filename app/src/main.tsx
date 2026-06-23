import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
// import { WalletProvider } from './context/WalletContext' // TODO Task 4: uncomment when WalletProvider is created
import './globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* <WalletProvider> */}
      <App />
      <Toaster richColors position="top-right" />
    {/* </WalletProvider> */}
  </React.StrictMode>
)
