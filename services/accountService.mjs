import Datastore from 'nedb';
import resultUtil from '../util/resultUtil';
import {toQuery, toCountedQuery} from '../util/dbUtil';
import config from '../config';

const db = new Datastore(config.db.inMemory ? {} : { filename: config.db.dbPath.accounts, autoload: true });
const dbTransaction = new Datastore(config.db.inMemory ? {} : { filename: config.db.dbPath.transactions, autoload: true });

db.ensureIndex({ fieldName: 'accountNr', unique: true, sparse: true });

function createTransactionObj(from, target, amount, total, date) {
    return {
        from,
        target,
        amount,
        total,
        date: date ? date : new Date()
    };
}

async function createAccount(ownerId, accountNr) {
    await toQuery(finish => {
        dbTransaction.insert(createTransactionObj("00000000", accountNr, config.account.initialBalance), finish);
    });

    return {
        ownerId,
        accountNr,
        amount: config.account.initialBalance
    };
}


async function add(ownerId, accountNr) {
    if (accountNr && ownerId) {
        const newAccount = await createAccount(ownerId, accountNr);

        return await toQuery(finish => {
            db.insert(newAccount, finish);
        });
    }
    throw resultUtil.createNotFoundResult();
}


async function get(accountNr) {
    if (accountNr) {
        const account = await toQuery(finish => {
            db.findOne({accountNr}, {_id: 0}, finish);
        });
        if (account) {
            return account;
        }
    }
    throw resultUtil.createNotFoundResult();
}

async function addTransaction(from, target, amount, date = null) {
    try {
        const fromAccount = await get(from);
        const targetAccount = await get(target);

        if (from !== target
            && !isNaN(amount) && amount > 0
            && fromAccount && fromAccount.amount >= amount
            && targetAccount) {

            let fromAccountAmount = fromAccount.amount - Number(amount);
            let targetAccountAmount = targetAccount.amount + Number(amount);

            const transactionFrom = await toQuery(finish => {
                dbTransaction.insert(createTransactionObj(from, target, -amount, fromAccountAmount, date), finish);
            });
            const transactionTarget = await toQuery(finish => {
                dbTransaction.insert(createTransactionObj(from, target, amount, targetAccountAmount, date), finish);
            });

            const affectedFromAccount = await toCountedQuery(finish => {
                db.update({accountNr: from}, {$set: {amount: fromAccountAmount}}, finish);
            });
            const affectedTargetAccount = await toCountedQuery(finish => {
                db.update({accountNr: target}, {$set: {amount: targetAccountAmount}}, finish);
            });

            delete transactionFrom._id;
            return transactionFrom;
        }
    } catch (err) {
        throw resultUtil.createErrorResult(err);
    }
}

async function getTransactions(accountId, count, skip, fromDate, toDate) {
    if (!(count || (fromDate && toDate))) {
        return {query: {count, skip, fromDate, toDate}, result: []};
    }

    let find = {
        $or: [
            {from: accountId, amount: {$lte: 0}},
            {target: accountId, amount: {$gte: 0}}
        ]
    };

    if (fromDate && toDate) {
        find["$and"] = [
            {date: {$gte: fromDate}},
            {date: {$lte: toDate}}
        ];
    }

    return await toQuery(finish => {
        let query = dbTransaction.find(find, {_id: 0}).sort({date: -1});
        if (skip > 0) {
            query = query.skip(skip);
        }
        if (count > 0) {
            query = query.limit(count);
        }
        dbTransaction.count(find, (err, resultcount) => {
            if (!err) {
                query.exec((err, docs) => {
                    finish(err, {query: {resultcount, count, skip, fromDate, toDate}, result: docs});
                });
            } else {
                finish(err);
            }
        });
    });
}

export default {add, get, addTransaction, getTransactions};
