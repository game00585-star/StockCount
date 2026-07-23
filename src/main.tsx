import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {registerSW} from 'virtual:pwa-register';import App from './App';import {initializeCloudData} from './services/firebaseSync';import './styles.css';
registerSW({immediate:true});
async function start(){await initializeCloudData();createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App/></BrowserRouter></StrictMode>);}
void start();
