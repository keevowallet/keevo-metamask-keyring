import  { JsonTx } from '@ethereumjs/tx';

const KEEVO_WEBSOCKET_BRIDGE_POPUP_URL = 'http://127.0.0.1:8080/';
const KEEVO_WEBEXTENSION_PORT_NAME = 'keevo-popup';

enum KeevoWebsocketBridgePopupMessageType {
  PopupClosed = 'keevo-popup-closed',
  PopupHasError = 'keevo-popup-error',
  GetXPub = 'keevo-popup-get-xpub-response',
  SignTransaction = 'keevp-popup-sign-transaction-response',
  SignMessage = 'keevo-popup-sign-message-response'
}

enum KeevoWebsocketBridgePopupMessageError {
  Abort = 'abort',
  Error = 'error'
}

enum KeevoWebsocketBridgePopupClientMessageType {
  GetXPub = 'keevo-get-xpub',
  SignTransaction = 'keevp-sign-transaction',
  SignMessage = 'keevo-sign-message'
}

type KeevoWebsocketBridgePopupMessageData = {
  type: KeevoWebsocketBridgePopupMessageType | KeevoWebsocketBridgePopupClientMessageType;
  id: number;
  payload: string;
};

type KeevoWebsocketBridgePopupMessage = {
  data: KeevoWebsocketBridgePopupMessageData;
}

export default class KeevoWebsocketBridgePopupClient {
  private static messageId: number = 0;

  private static isMessageIncoming(message: KeevoWebsocketBridgePopupMessage): boolean {
    const { type } = message.data;
    const allowedMessageTypes = Object.values(KeevoWebsocketBridgePopupMessageType) as string[];

    return allowedMessageTypes.includes(type);
  }

  private static isMessageResponse(message: KeevoWebsocketBridgePopupMessage): boolean {
    const { isMessageIncoming } = KeevoWebsocketBridgePopupClient;
    const { id } = message.data;

    return typeof id === 'number' && isMessageIncoming(message);
  }

  private popupTab: chrome.tabs.Tab | null = null;
  private extensionTab: chrome.tabs.Tab | null = null;
  private extensionPort: chrome.runtime.Port | null = null;

  constructor() {
    this.setEventHandlers();
  }

  private async setEventHandlers(): Promise<void> {
    const extensionPort = await this.getExtensionPort();

    const handlePopupClosedMessage = (message: KeevoWebsocketBridgePopupMessage) => {
      const { isMessageIncoming } = KeevoWebsocketBridgePopupClient;

      if (!isMessageIncoming(message)) return;

      const { type } = message.data;

      if (type === KeevoWebsocketBridgePopupMessageType.PopupClosed) {
        extensionPort.onMessage.removeListener(handlePopupClosedMessage)

        this.closePopupTab();
      }
    };

    extensionPort.onMessage.addListener(handlePopupClosedMessage);
  }

  private async postMessage(type: KeevoWebsocketBridgePopupClientMessageType, payload?: any): Promise<any> {
    await this.openPopupTab();

    const extensionPort = await this.getExtensionPort();
    const messageId = KeevoWebsocketBridgePopupClient.messageId++;

    return new Promise((resolve, reject) => {
      const handlePopupMessage = (message: KeevoWebsocketBridgePopupMessage) => {
        const { isMessageResponse } = KeevoWebsocketBridgePopupClient;
        const { type, payload, id } = message.data;

        if (type === KeevoWebsocketBridgePopupMessageType.PopupClosed) {
          reject(new Error('Popup was closed unexpectedly'));
          extensionPort.onMessage.removeListener(handlePopupMessage);
        } else if (type === KeevoWebsocketBridgePopupMessageType.PopupHasError) {
          reject(payload);
          extensionPort.onMessage.removeListener(handlePopupMessage)
        } else {
          if (id !== messageId || !isMessageResponse(message)) return;

          resolve(payload);
          extensionPort.onMessage.removeListener(handlePopupMessage);
        }
      };

      extensionPort.onMessage.addListener(handlePopupMessage);

      extensionPort.postMessage({
        type,
        payload,
        id: messageId
      });
    });
  }

  private getExtensionPort(): Promise<chrome.runtime.Port> {
    if (this.extensionPort) {
      Promise.resolve(this.extensionPort);
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
        if (port.name !== KEEVO_WEBEXTENSION_PORT_NAME) return;

        this.extensionPort = port;

        resolve(this.extensionPort);
      });
    });
  }

  private openPopupTab(): Promise<chrome.tabs.Tab> {
    if (this.popupTab?.id) {
      chrome.tabs.update(this.popupTab.id, { active: true });

      return Promise.resolve(this.popupTab);
    }

    return new Promise((resolve, reject) => {
      chrome.windows.getCurrent((currentWindow) => {
        if (currentWindow.type !== 'normal') {
          chrome.windows.create({
            url: KEEVO_WEBSOCKET_BRIDGE_POPUP_URL
          }, (newWindow: chrome.windows.Window | undefined) => {
            if (!newWindow) return;

            chrome.tabs.query({
              windowId: newWindow.id,
              active: true
            }, (tabs: chrome.tabs.Tab[]) => {
              this.popupTab = tabs[0];

              resolve(this.popupTab);
            });
          });
        } else {
          chrome.tabs.query({
            currentWindow: true,
            active: true
          }, (tabs: chrome.tabs.Tab[]) => {
            if (!tabs[0].id) {
              reject(new Error('An error occured during popup tab opening'));

              return;
            }

            this.extensionTab = tabs[0];

            chrome.tabs.create({
              url: KEEVO_WEBSOCKET_BRIDGE_POPUP_URL,
              index: tabs[0].index + 1
            }, (tab) => {
              this.popupTab = tab;

              resolve(this.popupTab);
            });
          });
        }
      });
    });
  }

  closePopupTab(): void {
    if (this.extensionPort) {
      this.extensionPort.disconnect();
      this.extensionPort = null;
    }

    if (this.popupTab?.id) {
      try {
        chrome.tabs.remove(this.popupTab.id);
      } finally {
        this.popupTab = null;
      }
    }

    if (this.extensionTab?.id) {
      try {
        chrome.tabs.update(this.extensionTab.id, { active: true });
      } finally {
        this.extensionTab = null;
      }
    }
  }

  async getXPub(derivationPath: string): Promise<string> {
    try {
      const xpub = await this.postMessage(KeevoWebsocketBridgePopupClientMessageType.GetXPub, {
        derivationPath
      });

      return xpub;
    } catch (error) {
      if (error === KeevoWebsocketBridgePopupMessageError.Abort) {
        throw new Error('Account adding was aborted');
      } else if (error === KeevoWebsocketBridgePopupMessageError.Error) {
        throw new Error('Something went wrong. Please try again');
      } else {
        throw error;
      }
    } finally {
      this.closePopupTab();
    }
  }

  async signTransaction(
    address: string,
    derivationPath: string,
    transaction: JsonTx
  ): Promise<string> {
    try {
      const signedTransaction = await this.postMessage(KeevoWebsocketBridgePopupClientMessageType.SignTransaction, {
        address,
        derivationPath,
        transaction
      });

      return signedTransaction;
    } catch (error) {
      if (error === KeevoWebsocketBridgePopupMessageError.Abort) {
        throw new Error('Transaction signing was aborted');
      } else if (error === KeevoWebsocketBridgePopupMessageError.Error) {
        throw new Error('Something went wrong. Please try again');
      } else {
        throw error;
      }
    } finally {
      this.closePopupTab();
    }
  }

  async signMessage(
    derivationPath: string,
    message: string,
  ): Promise<string> {
    try {
      const signedMessage = await this.postMessage(KeevoWebsocketBridgePopupClientMessageType.SignMessage, {
        derivationPath,
        message
      });

      return signedMessage;
    } catch (error) {
      if (error === KeevoWebsocketBridgePopupMessageError.Abort) {
        throw new Error('Message signing was aborted');
      } else if (error === KeevoWebsocketBridgePopupMessageError.Error) {
        throw new Error('Something went wrong. Please try again');
      } else {
        throw error;
      }
    } finally {
      this.closePopupTab();
    }
  }
}
