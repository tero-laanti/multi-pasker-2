import './style.css';
import { PhoneApp } from './app';

const root = document.getElementById('phone')!;
const app = new PhoneApp(root);
app.start();
(window as unknown as { __phone: PhoneApp }).__phone = app;
