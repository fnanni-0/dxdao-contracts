"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.UpgradeScheme = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _utils = require('./utils.js');

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var dopts = require('default-options');

var SolidityUpgradeScheme = (0, _utils.requireContract)("UpgradeScheme");
var DAOToken = (0, _utils.requireContract)("DAOToken");

var UpgradeScheme = exports.UpgradeScheme = function (_ExtendTruffleContrac) {
    _inherits(UpgradeScheme, _ExtendTruffleContrac);

    function UpgradeScheme() {
        _classCallCheck(this, UpgradeScheme);

        return _possibleConstructorReturn(this, (UpgradeScheme.__proto__ || Object.getPrototypeOf(UpgradeScheme)).apply(this, arguments));
    }

    _createClass(UpgradeScheme, [{
        key: 'proposeController',


        /*******************************************
         * proposeController
         */
        value: async function proposeController() {
            var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

            var defaults = {
                /**
                 * avatar address
                 */
                avatar: undefined
                /**
                 *  controller address
                 */
                , controller: undefined
            };

            var options = dopts(opts, defaults);

            if (!options.avatar) {
                throw new Error("avatar address is not defined");
            }

            if (!options.controller) {
                throw new Error("controller address is not defined");
            }

            var tx = await this.contract.proposeUpgrade(options.avatar, options.controller);

            return tx;
        }

        /********************************************
         * proposeUpgradingScheme
         */

    }, {
        key: 'proposeUpgradingScheme',
        value: async function proposeUpgradingScheme() {
            var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};


            var defaults = {
                /**
                 * avatar address
                 */
                avatar: undefined
                /**
                 *  upgrading scheme address
                 */
                , scheme: undefined
                /**
                 * hash of the parameters of the upgrading scheme
                 */
                , schemeParametersHash: undefined
                /**
                 * address of token that will be used by the upgrading scheme when it is required to pay for something.
                 * Should be the NativeToken of the new upgrading scheme.
                 * Only required when fee is non-zero.  Should be the SchemeFee of the upgrading scheme.
                 */
                // , tokenAddress: null
                /**
                 * fee to charge when fulfilling it's functions
                 */
                // , fee: 0
            };

            var options = dopts(opts, defaults);

            if (!options.avatar) {
                throw new Error("avatar address is not defined");
            }

            if (!options.scheme) {
                throw new Error("scheme is not defined");
            }

            if (!options.schemeParametersHash) {
                throw new Error("schemeParametersHash is not defined");
            }

            // if ((options.fee < 0))
            // {
            //   throw new Error("fee cannot be less than 0");
            // }

            // if ((options.fee > 0) && !options.tokenAddress)
            // {
            //   throw new Error("fee is greater than zero but tokenAddress is not defined");
            // }

            var newScheme = await settings.daostackContracts.UpgradeScheme.contract.at(options.scheme);
            var fee = await newScheme.fee();
            var tokenAddress = await newScheme.nativeToken();

            var tx = await this.contract.proposeChangeUpgradingScheme(options.avatar, options.scheme, options.schemeParametersHash, tokenAddress, fee);

            return tx;
        }
    }, {
        key: 'setParams',
        value: async function setParams(params) {
            return await this._setParameters(params.voteParametersHash, params.votingMachine);
        }
    }, {
        key: 'getDefaultPermissions',
        value: function getDefaultPermissions(overrideValue) {
            return overrideValue || '0x00000009';
        }
    }], [{
        key: 'new',
        value: async function _new() {
            var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

            // TODO: provide options to use an existing token or specifiy the new token
            var defaults = {
                fee: 0, // the fee to use this scheme
                beneficiary: (0, _utils.getDefaultAccount)(),
                tokenAddress: null // the address of a token to use
            };

            var options = dopts(opts, defaults);

            var token = void 0;
            if (options.tokenAddress == null) {
                token = await DAOToken.new('schemeregistrartoken', 'SRT');
                // TODO: or is it better to throw an error?
                // throw new Error('A tokenAddress must be provided');
            } else {
                token = await DAOToken.at(options.tokenAddress);
            }

            contract = await SolidityUpgradeScheme.new(token.address, options.fee, options.beneficiary);
            return new this(contract);
        }
    }]);

    return UpgradeScheme;
}((0, _utils.ExtendTruffleContract)(SolidityUpgradeScheme));