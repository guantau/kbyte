'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var objectHash = _interopDefault(require('byteballcore/object_hash'));
var constants = _interopDefault(require('byteballcore/constants'));
var objectLength = _interopDefault(require('byteballcore/object_length'));
var Promise = _interopDefault(require('bluebird'));
var crypto = _interopDefault(require('crypto'));
var Mnemonic = _interopDefault(require('bitcore-mnemonic'));
var Bitcore = _interopDefault(require('bitcore-lib'));
var validationUtils = _interopDefault(require('byteballcore/validation_utils'));

let WebSocket;
if (typeof window !== 'undefined') {
  WebSocket = window.WebSocket;
} else {
  WebSocket = require('ws');
}

const wait = (ws, cb) => {
  setTimeout(() => {
    if (ws.readyState === 1) {
      if (cb !== null) cb();
    } else {
      wait(ws, cb);
    }
  }, 5);
};

class Client {
  constructor(address) {
    this.address = address;
    this.open = false;
    this.queue = {};

    this.ws = new WebSocket(address);

    this.ws.addEventListener('message', (data) => {
      const message = JSON.parse(data.data);
      if (this.queue[message[1].tag]) {
        this.queue[message[1].tag](null, message[1].response);
      } else {
        console.log(message);
      }
    });

    this.ws.addEventListener('open', () => {
      this.open = true;
    });

    this.ws.addEventListener('close', () => {
      this.open = false;
    });
  }

  send(command, params, cb) {
    const request = { command };
    if (params) request.params = params;
    request.tag = objectHash.getBase64Hash(request);
    this.queue[request.tag] = cb;
    const message = JSON.stringify(['request', request]);

    wait(this.ws, () => {
      this.ws.send(message);
    });
  };

  async compose(fromAddress, app, payload, privKeys, cb) {
    const witnesses = await this.send('get_witnesses', null);
    const parents = await this.send('light/get_parents_and_last_ball_and_witness_list_unit', { witnesses });

    const unit = {
      version: constants.version,
      alt: constants.alt,
      witness_list_unit: parents.witness_list_unit,
      last_ball_unit: parents.last_stable_mc_ball_unit,
      last_ball: parents.last_stable_mc_ball,
      main_chain_index: parents.last_stable_mc_ball_mci,
      parent_units: [parents.parent_units[0]],
      messages: [{
        app,
        payload_hash: objectHash.getBase64Hash(payload),
        payload_location: 'inline',
        payload,
      }],
    };

    unit.authors = [{
      address: fromAddress,
      /** TODO */
      authentifiers: { r: 'FcDdiq5ZEwZbt/vycdEq1hIL8v7BrLypbl87KfzEixdNLYEs2Hd+ONU1iGp2DIFGsveHCzAvdWDdvTXu0xo39w==' },
      definition: ['sig', { pubkey: 'AspyUbU+sClLe98bBheBpBjS37y/2wFnHTfI5N3rRIpg' }]
    }];
    unit.unit = objectHash.getUnitHash(unit);
    unit.timestamp = Math.floor(Date.now() / 1000);
    unit.headers_commission = objectLength.getHeadersSize(unit);
    unit.payload_commission = objectLength.getTotalPayloadSize(unit);

    const joint = {
      ball: objectHash.getBallHash(unit.unit),
      unit,
    };

    try {
      return await this.send('post_joint', { joint });
    } catch (e) {
      console.log(e);
      return e;
    }
  };
}

Client.prototype.send = Promise.promisify(Client.prototype.send);
Client.prototype.compose = Promise.promisify(Client.prototype.compose);

/**
 * Generate Private Account
 * @returns {{address: *, pub_key, priv_key: string, mnemonic_phrase: *}}
 */
const genPrivAccount = () => {
  const passphrase = 'passphrase';

  const deviceTempPrivKey = crypto.randomBytes(32);
  const devicePrevTempPrivKey = crypto.randomBytes(32);

  let mnemonic = new Mnemonic();
  while (!Mnemonic.isValid(mnemonic.toString()))
    mnemonic = new Mnemonic();

  const keys = {
    mnemonic_phrase: mnemonic.phrase,
    temp_priv_key: deviceTempPrivKey.toString('base64'),
    prev_temp_priv_key: devicePrevTempPrivKey.toString('base64')
  };

  const xPrivKey = mnemonic.toHDPrivateKey(passphrase);
  const devicePrivKey = xPrivKey.derive("m/1'").privateKey.bn.toBuffer({ size: 32 });
  const strXPubKey = Bitcore.HDPublicKey(xPrivKey.derive("m/44'/0'/0'")).toString();

  const wallet = crypto.createHash('sha256').update(strXPubKey, 'utf8').digest('base64');

  function derivePubkey(xPubKey, path){
    const hdPubKey = new Bitcore.HDPublicKey(xPubKey);
    return hdPubKey.derive(path).publicKey.toBuffer().toString('base64');
  }

  const isChange = 0;
  const addressIndex = 1;
  const pubkey = derivePubkey(strXPubKey, `m/${isChange}/${addressIndex}`);
  const address = objectHash.getChash160(['sig', { pubkey }]);

  return {
    address,
    pub_key: pubkey,
    priv_key: devicePrivKey.toString('base64'),
    mnemonic_phrase: keys.mnemonic_phrase,
  };
};

var unsafe = {
  genPrivAccount,
  isValidAddress: validationUtils.isValidAddress,
  isValidDeviceAddress: validationUtils.isValidDeviceAddress,
};

exports.Client = Client;
exports.unsafe = unsafe;
