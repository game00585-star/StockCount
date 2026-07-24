import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  server:{host:'0.0.0.0',port:5173,strictPort:true,allowedHosts:['.app.github.dev']},
  preview:{host:'0.0.0.0',port:4173},
  plugins:[
    react(),
    tailwindcss()
  ]
});
