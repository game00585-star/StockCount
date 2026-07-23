import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig({
  server:{host:'0.0.0.0',port:5173,strictPort:true,allowedHosts:['.app.github.dev']},
  preview:{host:'0.0.0.0',port:4173},
  plugins:[
    react(),
    tailwindcss(),
    VitePWA({
      registerType:'autoUpdate',
      manifest:{
        name:'Audit Stock Count',
        short_name:'Audit Stock',
        description:'ระบบนับสต็อกสำหรับฝ่าย Audit',
        theme_color:'#b4233b',
        background_color:'#fff8f8',
        display:'standalone',
        start_url:'/',
        icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml'}]
      }
    })
  ]
});
