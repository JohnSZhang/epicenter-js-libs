'use strict';

var UsersCollection = require('./users-collection');
var WorldsCollection = require('./worlds-collection');
var ProjectModel = require('./project-model');
var AssignemntRow = require('./assignment-row');
var env = require('./defaults');
var AjaxQueue = require('../../../util/ajax-queue');

function setEnvironment(options) {
    env.set(_.omit(options, 'el'));
}

var Assignment = function (options) {
    setEnvironment(options);
    this.initialize(options);
};

Assignment.prototype = {

    initialize: function (options) {
        this.el = typeof options.el === 'string' ? $(options.el)[0] : options.el;
        this.$el = $(this.el);
        this.$ = _.partialRight($, this.el);

        this.users = new UsersCollection();
        this.worlds = new WorldsCollection();
        this.project = new ProjectModel();

        _.bindAll(this, ['render', 'renderTable', 'toggleControlls', 'saveEdit', 'selectAll', 'usassignSelected', '_showUpdating', '_hideUpdating', 'autoAssignAll', 'makeUserInactive']);

        this.bindEvents();
    },

    bindEvents: function () {
        this.$el.on('update', 'tr', this.saveEdit);
        this.$el.on('click', 'input:checkbox:not(#select-all)', this.toggleControlls);
        this.$el.on('click', '#select-all', this.selectAll);
        this.$el.on('click', '.unassign-user', this.usassignSelected);
        this.$el.on('click', '.auto-assign-all', this.autoAssignAll);
        this.$el.on('click', '.make-user-inactive', this.makeUserInactive);
    },

    load: function () {

        var join = function () {
            this.worlds.setUsersCollection(this.users);
            this.worlds.joinUsers();
            this.render();
        }.bind(this);

        return $.when(
            this.worlds.fetch(),
            this.users.fetch(),
            this.project.fetch()
        ).then(join);

    },

    saveEdit: function () {
        this.worlds.fetch()
            .then(function () {
                this.worlds.joinUsers();
                this.render();
                this.updateControls();
            }.bind(this));
    },

    autoAssignAll: function () {
        this._showUpdating();
        var maxUsers = +this.$('#max-users').val();
        return this.worlds.autoAssignAll({ maxUsers: maxUsers })
            .done(this._hideUpdating)
            .fail(this._hideUpdating)
            .then(function () {
                this.worlds.joinUsers();
                this.render();
            }.bind(this));
    },

    getSelectedIds: function () {
        return this.$('tbody :checkbox:checked').map(function () {
            return $(this).data('id');
        });
    },

    findRowViews: function (ids) {
        return _.map(ids, function (id) {
            return this.rowViews[id];
        }, this);
    },

    unassignUsers: function (ids) {
        var dtd = $.Deferred();
        var done = function () {
            dtd.resolve();
        };

        // for now we need to sequence the calls to unassign users from worlds
        var queue = new AjaxQueue();

        _.each(ids, function (userId) {
            var user = this.users.getById(userId);
            user.set('world', '');
            user.set('role', '');
            queue.add(_.partial(_.bind(this.worlds.updateUser, this.worlds), user));
        }, this);

        queue.execute(this).then(done);

        return dtd.promise();
    },

    usassignSelected: function (e) {
        e.preventDefault();

        var ids = this.getSelectedIds();

        var done = function () {
            this.worlds.fetch().then(function () {
                this.worlds.joinUsers();
                this._hideUpdating();
                this.render();

            }.bind(this));
        }.bind(this);

        this._showUpdating();

        return this.unassignUsers(ids).then(done);
    },

    makeUserInactive: function (e) {
        e.preventDefault();
        var ids = this.getSelectedIds();
        var done = function () {
            this.toggleControlls();
        }.bind(this);

        var makeUsersInactive = function () {
            var rows = this.findRowViews(ids);
            // for now we need to sequence the calls to patch the users
            // since the API can only operate on one call per group at a time
            var queue = new AjaxQueue();
            _.each(rows, function (view) {
                var user = view.model;
                queue.add(function () {
                    return view.makeInactive()
                        .then(function () {
                            user.remove();
                            view.remove();
                        });
                    });

            }, this);

            queue.execute(this).then(done);
        }.bind(this);

        return this.unassignUsers(ids)
            .then(makeUsersInactive);


    },

    render: function () {
        this.$('table tbody').empty();
        this.renderTable();
        this.toggleControlls();
    },

    renderTable: function () {
        this.rowViews = {};
        var rows = [];
        this.users.each(function (u) {
            var view = new AssignemntRow({ model: u, worlds: this.worlds, project: this.project });
            this.rowViews[u.get('id')] = view;
            rows.push(view.render().el);
        }, this);

        this.$('table tbody').append(rows);
    },


    updateControls: function () {
        this.updateControlsForSelection();
        this.updateAutoAssignButton();
        this.updateStatus();
    },

    updateStatus: function () {
        var incolpleteWorlds = this.worlds.getIncompleteWorldsCount();
        var unassignedUsers = this.users.getUnassignedUsersCount();
        var totalWorlds = this.worlds.size();

        var usersText = unassignedUsers ? unassignedUsers === 1 ? '1 user needs assignment.' : unassignedUsers + ' users need assignment.' : 'All users have been assigned.';
        var worldsText = !totalWorlds ? 'No worlds have been created.' : !incolpleteWorlds ? 'All worlds are complete.' : incolpleteWorlds === 1 ? '1 incomplete world needs attention.' : incolpleteWorlds + ' incomplete worlds need attention.';

        this.$('#users-status .text').text(usersText);
        this.$('#worlds-status .text').text(worldsText);

        if (unassignedUsers) {
            this.$('#users-status').addClass('incomplete');
        } else {
            this.$('#users-status').removeClass('incomplete');
        }

        if (incolpleteWorlds || !totalWorlds) {
            this.$('#worlds-status').addClass('incomplete');
        } else {
            this.$('#worlds-status').removeClass('incomplete');
        }

        this.$('.status-widget').addClass('visible');
    },

    updateControlsForSelection: function () {
        var numSelected = this.$('tbody :checkbox:checked').length;
        this.$('.component.controls')[numSelected ? 'addClass' : 'removeClass']('visible');
    },

    updateAutoAssignButton: function () {

        if (this.project.isDynamicAssignment()) {
            var hasRoles = this.project.hasRoles();
            this.$('.table-controls .single').hide();
            this.$('.table-controls .dynamic').show();
            this.$('.table-controls .dynamic-no-roles-text')[hasRoles ? 'hide' : 'show']();
            this.$('.table-controls .no-roles')[hasRoles ? 'hide' : 'show']();
        } else {
            this.$('.table-controls .dynamic').hide();
            this.$('.table-controls .dynamic-no-roles-text').hide();
            this.$('.table-controls .single').show();
            this.$('.table-controls .no-roles').show();

        }

        if (this.users.allUsersAssigned()) {
            this.$('.table-controls').removeClass('visible');
        } else {
            this.$('.table-controls').addClass('visible');
        }
    },

    selectAll: function (e) {
        this.$('tbody :checkbox').prop('checked', e.target.checked);
        this.updateControls();
    },

    toggleControlls: function (e) {
        var total = this.$('tbody :checkbox');
        var checked = this.$('tbody :checkbox:checked');

        if (total.length === checked.length) {
            this.$('#select-all').attr('checked', 'checked');
        } else {
            this.$('#select-all').removeAttr('checked');
        }

        this.updateControls();
    },

    _showUpdating: function () {
        this.$el.css({ opacity: 0.4 });
    },

    _hideUpdating: function () {
        this.$el.css({ opacity: 1 });
    }

};

module.exports = Assignment;