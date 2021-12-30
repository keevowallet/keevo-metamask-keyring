const popupUrl = process.env.KEEVO_WEBSOCKET_BRIDGE_POPUP_URL;

if (!popupUrl) {
  console.error('Popup URL is not specified');

  process.exit(1);
}

if (typeof popupUrl !== 'string') {
  console.error('Popup URL is not a string');

  process.exit(1);
}

console.log('popupUrl', popupUrl);

if (!/^https:\/\//.test(popupUrl)) {
  console.error('Popup URL is not https URL');

  process.exit(1);
}