import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import App from './App';import {initializeCloudData} from './services/firebaseSync';import './styles.css';
function start(){createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App/></BrowserRouter></StrictMode>);window.setTimeout(()=>void initializeCloudData(),750);}
start();
