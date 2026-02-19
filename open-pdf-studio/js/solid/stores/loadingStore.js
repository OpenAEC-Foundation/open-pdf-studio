import { createSignal } from 'solid-js';

const [visible, setVisible] = createSignal(false);
const [message, setMessage] = createSignal('Loading...');

export { visible, setVisible, message, setMessage };
