import Datastore from 'nedb';

import cryptoUtil from '../util/cryptoUtil';
import resultUtil from '../util/resultUtil';
import {toQuery, toCountedQuery} from '../util/dbUtil';

import config from '../config';
import accountService from './accountService';

const db = new Datastore(config.db.inMemory ? {} : { filename: config.db.dbPath.users, autoload: true });

// DB schema / settings
db.ensureIndex({ fieldName: 'login', unique: true, sparse: true });
db.ensureIndex({ fieldName: 'accountNr', unique: true, sparse: true });

let accountNumberOffset = 1000000;

db.count({}, function (err, count) {
    accountNumberOffset = accountNumberOffset + count;
});


function createUserObj(login, firstname, lastname, password) {
  let user = {login, firstname, lastname};
  user.passwordHash = cryptoUtil.hashPwd(password);
  user.accountNr = String(++accountNumberOffset);
  return user;
}

async function getById(id) {
    try {
        const user = await toQuery(finish => {
            db.findOne({_id: id}, {_id: 0, passwordHash: 0}, finish);
        });
        if (user) {
          return user;
        }
        throw resultUtil.createNotFoundResult();
    } catch (err) {
        throw resultUtil.createNotFoundResult(err);
    }
}

async function tryGetByLogin(login) {
    try {
        return await toQuery(finish => {
            db.findOne({login}, {_id: 0, passwordHash: 0}, finish);
        });
    } catch (err) {
        throw resultUtil.createNotFoundResult();
    }
}

async function register(login, firstname, lastname, password) {
  if (login && firstname && lastname && password) {
      let userObject;
      try {
          userObject = await toQuery(finish => {
              db.insert(createUserObj(login, firstname, lastname, password), finish);
          });
      } catch (err) {
          throw resultUtil.createErrorResult(err);
      }

      if (userObject) {
          const account = await accountService.add(userObject._id, userObject.accountNr);
          if (account) {
              return await tryGetByLogin(login)
          }
      }
  }
  throw resultUtil.createErrorResult();
}

async function login(login, password) {
    if (login && password) {
        try {
            let userObject = await toQuery(finish => {
                db.findOne({$or: [{login: login}, {accountNr: login}]}, finish);
            });

            if (userObject && userObject.passwordHash === cryptoUtil.hashPwd(password)) {
                let {login, firstname, lastname, accountNr} = userObject;
                const owner = {login, firstname, lastname, accountNr};
                const token = await cryptoUtil.createToken(owner, config.jwt.jwtSecret, config.jwt.signOptions);

                return {token, owner};
            }
        } catch (err) {
            throw resultUtil.createErrorResult(err);
        }
    }
    throw resultUtil.createNotFoundResult();
}

export default {getById, tryGetByLogin, register, login};