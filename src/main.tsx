import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import App from './App';import {initializeCloudData} from './services/firebaseSync';import {initializeSharePointBackup} from './services/sharePointBackup';import './styles.css';
function start(){createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App/></BrowserRouter></StrictMode>);void initializeCloudData();initializeSharePointBackup();}
start();
