'use strict';

var classFrom = require('../../util/inherit');
var IdentityStrategy = require('./identity-strategy');
var StorageFactory = require('../../store/store-factory');
var StateApi = require('../../service/state-api-adapter');
var AuthManager = require('../auth-manager');
var keyNames = require('../key-names');

var defaults = {
    store: {
        synchronous: true
    }
};

var Strategy = classFrom(IdentityStrategy, {
    constructor: function Strategy(runService, options) {
        this.run = runService;
        this.options = $.extend(true, {}, defaults, options);
        this.runOptions = this.options.run;
        this._store = new StorageFactory(this.options.store);
        this.stateApi = new StateApi();
        this._auth = new AuthManager();

        this._loadAndCheck = this._loadAndCheck.bind(this);
        this._restoreRun = this._restoreRun.bind(this);
        this._getAllRuns = this._getAllRuns.bind(this);
        this._loadRun = this._loadRun.bind(this);
    },

    reset: function (runServiceOptions) {
        // creates a grand new run with group id (account too?) and set freshly created to true
        var session = this._auth.getCurrentUserSessionInfo();
        var opt = $.extend({
            scope: { group: session.groupId }
        }, this.runOptions);

        return this.run
            .create(opt, runServiceOptions)
            .then(function (run) {
                run.freshlyCreated = true;
                return run;
            });
    },

    getRun: function () {
        return this._getAllRuns()
            .then(this._loadAndCheck);
    },

    _getAllRuns: function () {
        // get all runs with the current user and group, to be filtered later
        var session = JSON.parse(this._store.get(keyNames.EPI_SESSION_KEY) || '{}');
        return this.run.query({
            'user.id': session.userId || '0000',
            'scope.group': session.groupId
        });
    },

    _loadAndCheck: function (runs) {
        // Check if latest run is not yet initialized, if not we load it, else we load the baserun, else create new run
        if (!runs || !runs.length) {
            return this.reset();
        }
        var latestRun = this._sortRuns(runs)[0];
        var _this = this;
        var shouldReplay = false;
        var baseRuns = this._sortRuns(this._baseRuns(runs));


        if (!latestRun.initialized) {
            // uninitialized run will have finish initializing first
            return this.run.load(latestRun.id, null, {
                success: function (run, msg, headers) {
                    shouldReplay = headers.getResponseHeader('pragma') === 'persistent';
                }
            }).then(function (run) {
                return shouldReplay ? _this._restoreRun(run.id) : run;
            });
        } else if (baseRuns && baseRuns.length) {
            var baseRun = baseRuns[0];
            return this.run.load(baseRun.id, null, {
                success: function (run, msg, headers) {
                    shouldReplay = headers.getResponseHeader('pragma') === 'persistent';
                }
            }).then(function (run) {
                return shouldReplay ? _this._restoreRun(run.id) : run;
            });
        } else {
            return this.reset();
        }
    },

    _sortRuns: function (runs) {
        var dateComp = function (a, b) { return new Date(b.date) - new Date(a.date); };
        return runs.sort(dateComp);
    },

    _baseRuns: function (runs) {
        return _.filter(runs, function (run) {
            return run.baseRun;
        });
    },

    _restoreRun: function (runId) {
        var _this = this;
        return this.stateApi.replay({ runId: runId })
            .then(function (resp) {
                return _this._loadRun(resp.run);
            });
    },

    _loadRun: function (id, options) {
        return this.run.load(id, null, options);
    }

});

module.exports = Strategy;
