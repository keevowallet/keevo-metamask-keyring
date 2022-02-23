import { EventEmitter } from 'events';
import HDKey from 'hdkey';
import create from 'keccak';
import { publicKeyConvert } from 'secp256k1';
import TxDecoder from 'ethereum-tx-decoder';
import { FeeMarketEIP1559Transaction, TypedTransaction, TransactionFactory, TxData } from '@ethereumjs/tx';

import KeevoWebsocketBridgePopupClient from '../keevo-websocket-bridge-popup-client';
import { MessageTypes, SignTypedDataVersion, TypedDataUtils, TypedMessage } from '@metamask/eth-sig-util';

type KeevoKeyringAccount = {
  address: string;
  derivationPath: string;
};

type KeevoKeyringSettings = {
  hdPath: string;
  accounts: KeevoKeyringAccount[];
  lastUnlockedAccountIndex: number;
  page: number;
};

type PageAccount = {
  address: string;
  balance: number | null;
  index: number;
};

export default class KeevoKeyring extends EventEmitter {
  static readonly type: string = 'Keevo Hardware';

  static readonly DEFAULT_HD_PATH: string = `m/44'/60'/0'/0`;
  static readonly MAX_ACCOUNTS_NUMBER: number = 1;
  static readonly ACCOUNTS_PER_PAGE_NUMBER: number = 1;
  static readonly MAX_PAGES_NUMBER: number = Math.ceil(
    KeevoKeyring.MAX_ACCOUNTS_NUMBER / KeevoKeyring.ACCOUNTS_PER_PAGE_NUMBER,
  );

  static removeHexPrefix(text: string): string {
    return text.replace(/^0x/, '');
  }

  static addHexPrefix(text: string): string {
    return '0x' + KeevoKeyring.removeHexPrefix(text);
  }

  static decompressPublicKey(publicKey: Buffer): Buffer {
    const publicKeyBytes = new Uint8Array(publicKey);

    return Buffer.from(publicKeyConvert(publicKeyBytes, false).slice(1));
  }

  static getEthereumAddress(publicKey: Buffer): string {
    const decompressedPublicKey = KeevoKeyring.decompressPublicKey(publicKey);

    const addressWithoutChecksum = KeevoKeyring.removeHexPrefix(
      create('keccak256')
        .update(decompressedPublicKey)
        .digest('hex')
        .slice(-40)
        .toLowerCase()
    );

    const hash = create('keccak256')
      .update(addressWithoutChecksum)
      .digest('hex');

    let addressWithChecksum = '';

    for (let i = 0; i < addressWithoutChecksum.length; i++) {
      addressWithChecksum +=
        parseInt(hash[i], 16) >= 8
          ? addressWithoutChecksum[i].toUpperCase()
          : addressWithoutChecksum[i];
    }

    return KeevoKeyring.addHexPrefix(addressWithChecksum);
  }

  private keevoConnect: KeevoWebsocketBridgePopupClient = new KeevoWebsocketBridgePopupClient();

  type: string = KeevoKeyring.type;
  hdKey: HDKey | null = null;
  hdPath: string = KeevoKeyring.DEFAULT_HD_PATH;
  accounts: KeevoKeyringAccount[] = [];
  lastUnlockedAccountIndex: number = 0;
  page: number = 0;

  constructor(options: Partial<KeevoKeyringSettings> = {}) {
    super();

    this.deserialize(options);
  }

  async serialize(): Promise<KeevoKeyringSettings> {
    return {
      hdPath: this.hdPath,
      accounts: this.accounts,
      lastUnlockedAccountIndex: this.lastUnlockedAccountIndex,
      page: this.page,
    };
  }

  async deserialize(options: Partial<KeevoKeyringSettings> = {}): Promise<void> {
    this.hdPath = options.hdPath || KeevoKeyring.DEFAULT_HD_PATH;
    this.accounts = options.accounts || [];
    this.lastUnlockedAccountIndex = options.lastUnlockedAccountIndex || 0;
    this.page = options.page || 0;
  }

  async getAccounts(): Promise<string[]> {
    return this.accounts.map((account: KeevoKeyringAccount) => account.address);
  }

  isUnlocked(): boolean {
    return Boolean(this.hdKey);
  }

  setHdPath(newHdPath: string): void {
    if (newHdPath !== this.hdPath) {
      this.resetState();
    }

    this.hdPath = newHdPath;
  }

  async getFirstPage(): Promise<PageAccount[]> {
    this.setCurrentPage(0);

    return this.getCurrentPageAccounts();
  }

  async getPreviousPage(): Promise<PageAccount[]> {
    this.setCurrentPage(this.page - 1);

    return this.getCurrentPageAccounts();
  }

  async getNextPage(): Promise<PageAccount[]> {
    this.setCurrentPage(this.page + 1);

    return this.getCurrentPageAccounts();
  }

  setCurrentPage(newCurrentPage: number): void {
    this.page =
      newCurrentPage <= 0
        ? 0
        : newCurrentPage < KeevoKeyring.MAX_PAGES_NUMBER
        ? newCurrentPage
        : KeevoKeyring.MAX_PAGES_NUMBER - 1;
  }

  async getHdKey(): Promise<HDKey> {
    if (this.hdKey !== null) {
      return this.hdKey;
    }

    const xpub = await this.keevoConnect.getXPub(this.hdPath);

    this.hdKey = HDKey.fromExtendedKey(xpub);

    return this.hdKey;
  }

  removeHdKey(): void {
    this.hdKey = null;
  }

  async getCurrentPageAccounts(): Promise<PageAccount[]> {
    const from = this.page * KeevoKeyring.ACCOUNTS_PER_PAGE_NUMBER;
    const to = from + KeevoKeyring.ACCOUNTS_PER_PAGE_NUMBER;

    const hdKey = await this.getHdKey();

    const currentPageAccounts: PageAccount[] = [];

    for (let i = from; i < to && i < KeevoKeyring.MAX_ACCOUNTS_NUMBER; i++) {
      const derivedHdKey = hdKey.derive(`m/0/${i}`);
      const address = KeevoKeyring.getEthereumAddress(derivedHdKey.publicKey);

      currentPageAccounts.push({
        address,
        balance: null,
        index: i,
      });
    }

    return currentPageAccounts;
  }

  async addAccounts(accountsToAddNumber: number = 1): Promise<string[]> {
    const from = this.lastUnlockedAccountIndex;
    const to = from + accountsToAddNumber;

    const hdKey = await this.getHdKey();

    for (let i = from; i < to && i < KeevoKeyring.MAX_ACCOUNTS_NUMBER; i++) {
      const derivedHdKey = hdKey.derive(`m/0/${i}`);
      const derivationPath = `${this.hdPath}/${i}`;
      const address = KeevoKeyring.getEthereumAddress(derivedHdKey.publicKey);

      const isAccountExisting = this.accounts.some((account: KeevoKeyringAccount) => account.address === address);

      if (!isAccountExisting) {
        this.accounts.push({
          derivationPath,
          address
        });
      }
    }

    this.setCurrentPage(0);
    this.removeHdKey();

    return this.accounts.map((account: KeevoKeyringAccount) => account.address);
  }

  setAccountToUnlock(unlockedAccountIndex: number): void {
    this.lastUnlockedAccountIndex = Number(unlockedAccountIndex);
  }

  async signTransaction(
    address: string,
    transaction: FeeMarketEIP1559Transaction
  ): Promise<TypedTransaction> {
    const accountWithAddress = this.accounts.find(
      (account: KeevoKeyringAccount) => account.address.toLowerCase() === address.toLowerCase()
    );

    if (!accountWithAddress) {
      throw new Error(
        `Address ${address} not found in this keyring`,
      );
    }

    const transactionData = transaction.toJSON();
    const encodedSignedTransaction = await this.keevoConnect.signTransaction(
      address,
      accountWithAddress.derivationPath,
      transactionData
    );
    const decodedSignedTransaction = TxDecoder.decodeTx(KeevoKeyring.addHexPrefix(encodedSignedTransaction));

    const { v, r, s } = decodedSignedTransaction;

    const transactionFactoryData: TxData = {
      ...transactionData,
      type: 0, // Now Keevo Wallet supports 0 type only
      gasPrice: KeevoKeyring.addHexPrefix((Number(transactionData.maxFeePerGas)).toString(16)),
      v: KeevoKeyring.addHexPrefix(v.toString(16)),
      r: KeevoKeyring.addHexPrefix(r.toString(16)),
      s: KeevoKeyring.addHexPrefix(s.toString(16)),
    };

    const resultTransaction = TransactionFactory.fromTxData(transactionFactoryData, {
      common: transaction.common,
      freeze: Object.isFrozen(transaction),
    });

    return resultTransaction;
  }

  async signMessage(address: string, messageAsHex: string): Promise<string> {
    return this.signPersonalMessage(address, messageAsHex);
  }

  async signPersonalMessage(address: string, messageAsHex: string): Promise<string> {
    const accountWithAddress = this.accounts.find(
      (account: KeevoKeyringAccount) => account.address.toLowerCase() === address.toLowerCase()
    );

    if (!accountWithAddress) {
      throw new Error(
        `Address ${address} not found in this keyring`,
      );
    }

    const signedMessage = await this.keevoConnect.signPersonalMessage(accountWithAddress.derivationPath, messageAsHex);
    const signedMessageWithHexPrefix = KeevoKeyring.addHexPrefix(signedMessage);

    return signedMessageWithHexPrefix;
  }

  async signTypedData(
    address: string,
    typedData: TypedMessage<MessageTypes>,
    options = {
      version: SignTypedDataVersion.V4
    }
  ): Promise<string> {
    if (options.version !== SignTypedDataVersion.V4) {
      throw new Error(`Typed data signing ${options.version} is not supported. Use ${SignTypedDataVersion.V4}`);
    }

    const accountWithAddress = this.accounts.find(
      (account: KeevoKeyringAccount) => account.address.toLowerCase() === address.toLowerCase()
    );

    if (!accountWithAddress) {
      throw new Error(
        `Address ${address} not found in this keyring`,
      );
    }

    const sanitizedTypedData = TypedDataUtils.sanitizeData(typedData);
    const jsonTypedData = JSON.stringify(sanitizedTypedData);

    const signedTypedData = await this.keevoConnect.signTypedData(accountWithAddress.derivationPath, jsonTypedData);
    const signedTypedDataHexPrefix = KeevoKeyring.addHexPrefix(signedTypedData);

    return signedTypedDataHexPrefix;
  }

  async exportAccount(): Promise<void> {
    throw new Error('Not supported on Keevo device');
  }

  removeAccount(accountToRemoveAddress: string): void {
    const accountToRemoveIndex = this.accounts.findIndex(
      (account: KeevoKeyringAccount) =>
        account.address.toLowerCase() === accountToRemoveAddress.toLowerCase(),
    );

    if (accountToRemoveIndex === -1) {
      throw new Error(
        `Address ${accountToRemoveAddress} not found in this keyring`,
      );
    } else {
      this.accounts.splice(accountToRemoveIndex, 1);
    }
  }

  forgetDevice(): void {
    this.resetState();
  }

  resetState(): void {
    this.accounts = [];
    this.page = 0;
    this.lastUnlockedAccountIndex = 0;
    this.hdPath = KeevoKeyring.DEFAULT_HD_PATH;
    this.hdKey = null;
  }
}
