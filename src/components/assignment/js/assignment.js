'use strict';

var UsersCollection = require('./users-collection');
var WorldsCollection = require('./worlds-collection');
var AssignemntRow = require('./assignment-row');

var Assignment = function (options) {
    this.initialize(options);
};

Assignment.prototype = {

    initialize: function (options) {
        this.el = options.el;
        this.$el = $(this.el);
        this.$ = _.partialRight($, this.el);

        this.users = new UsersCollection();
        this.worlds = new WorldsCollection();

        _.bindAll(this, ['render', 'renderTable']);

    },

    bindEvents: function () {
        this.$el.on('click', 'button.save', this.saveEdit);
    },

    load: function () {

        var join = _.after(2, function () {
            this.worlds.joinUsers(this.users);

            this.render();
        }.bind(this));

        this.worlds.fetch().then(join);
        this.users.fetch().then(join);
    },

    saveEdit: function () {

    },

    render: function () {
        this.renderTable();
    },

    renderTable: function () {

        var rows = [];
        this.users.each(function (u) {
            var view = new AssignemntRow({ model: u, worlds: this.worlds });
            rows.push(view.render().el);
        }, this);

        this.$('table tbody').append(rows);
    }

};

module.exports = Assignment;