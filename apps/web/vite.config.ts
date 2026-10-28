import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
 plugins:[react()],
 // Preview inherits the local API proxy; keep the audit URL stable.
 preview:{host:'127.0.0.1',port:4173,strictPort:true},
 server:{
  host:'localhost',port:5173,strictPort:true,
  proxy:{'/api':{target:'http://127.0.0.1:3001',changeOrigin:true}},
 },
});
