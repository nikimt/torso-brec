(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['jquery', 'underscore', 'handlebars', 'backbone-torso/modules/View'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('jquery'), require('underscore'), require('handlebars'), require('backbone-torso/modules/View'));
  } else {
    root.Torso.View = factory(root.$, root._, root.Handlebars, root.View);
  }
}(this, function($, _, Handlebars, View) {
  'use strict';

  /**
   * A view to handle BREC tables.
   *
   * Requires the initialization of a collection in the form of
   *    this.collection = this.createPrivateCollection(entryCacheCollection);
   *
   * @class BrecTableView
   */
  var brecView = View.extend({
    /*
     * This string is required by DataTables to display the table controls in the desired format.
     * See DataTables documentation: https://datatables.net/reference/option/dom
     */
    tableControls: '<"top-pagination" p><"filters" <"filter-row" <"showing-filter" li><"search-filter" f>>>rtp',
    columnOrder: [],
    colVisConfig: {
      'buttonText': "<span class='action-option icon-eye-open'></span>",
      'restore': "Restore",
     },


    // ----- Overrides -------------------------------------------------------------------------------------------------------------
    /**
     * @method initialize
     * @override
     */
    initialize: function() {
      this.columnConfig = this.columnInit();
      View.prototype.initialize.call(this);
    },

    /**
     * @method render
     * @override
     */
    render: function() {
      this._unplug();
      this.templateRender(this.$el, this.template);
      this.delegateEvents();
      this._plug();
    },

    /**
     * @method activateCallback
     * @override
     */
    activateCallback: function() {
      this.on('successServerRetrieval', this.successfulServerRetrieval);
      this.on('errorServerRetrieval', this.errorServerRetrieval);
      this.on('tableUpdateComplete', this.tableUpdateComplete);
    },

    /**
     * @method deactivateCallback
     * @override
     */
    deactivateCallback: function() {
      this.off('successServerRetrieval');
      this.off('errorServerRetrieval');
      this.off('tableUpdateComplete');
    },


    // ----- Helpers ---------------------------------------------------------------------------------------------------------------
    /**
     * Construct any additional resources.
     * Currently this occurs post rendering, and is used to initialize javascript widgets that affect the display.
     * @private
     * @method _plug
     */
    _plug: function() {
      this._brecTableInit();
      this._brecWidgetsInit();
    },

    /**
     * Cleanup any resources before rendering.
     * @private
     * @method _unplug
     */
    _unplug: function() {
      // FixedHeader generated its dom elements off of the body rather than relative to the table, so we need to clean this up.
      var fixedHeaderEl = $('.fixedHeader');
      if(fixedHeaderEl) {
        fixedHeaderEl.remove();
      }

      // Remove the window resize event.
      $(window).off('resize.updateFixedHeaderPosition');
    },

    /**
     * Initializes all of the BREC table widgets. Needs to be called after _brecTableInit.
     * @private
     * @method _brecWidgetsInit
     */
    _brecWidgetsInit: function() {
      // Initialize the show/hide button
      var colvis = new $.fn.dataTable.ColVis(this.dataTable, this.colVisConfig);
      this.$('.action-view').append($(colvis.button()));

      // Initialize the fixed headers
      this.tableHeader = new $.fn.dataTable.FixedHeader(this.dataTable, {
        zTop: 1,
        zLeft: 0,
        zRight: 0,
        zBottom: 0
      });

      // Need to update the FixedHeader positions on window resize
      $(window).on('resize.updateFixedHeaderPosition', this._updateFixedHeaderPos.bind(this));
    },

    /**
     * Updates the position of the FixedHeader. Used to position it correctly without having to reinitialize the widget.
     * @private
     * @method _updateFixedHeaderPos
     */
    _updateFixedHeaderPos: function() {
      this.tableHeader._fnUpdateClones(true);
    },

    /**
     * Extends dataTable options, retaining the defaults
     * @private
     * @method _extendOptions
     */
    _extendOptions: function() {
      _.extend(this.colVisConfig, this.extendColVisOptions);
    },

    /**
     * Initializes the BREC table.
     * Default method may be extended with view.brecOptionsOverrides.
     * @method brecTableInit
     */
    _brecTableInit: function() {
      var view = this;
      var tableEl = this.$el.find('.table-data');
      this.dataTable = $(tableEl).DataTable(_.extend({
        'dom': view.tableControls,
        'stateSave': true,
        'serverSide': true,
        'responsive': true,
        'ajax': view._requestData.bind(view),
        'fnStateLoadCallback': function ( settings ) {
          try {
            var data = JSON.parse(
              (settings.iStateDuration === -1 ? sessionStorage : localStorage).getItem('DataTables_settings_' + location.pathname)
            );
            view.columnOrder = data.columnOrder;
            return data;
          } catch (e) {
            // Errors here indicate a failure to parse the settings JSON. Since this is a non-critical system, fail silently.
          }
        },
        'fnStateSaveCallback': function ( settings, data ) {
          try {
            data.columnOrder = view.columnOrder;
            (settings.iStateDuration === -1 ? sessionStorage : localStorage).setItem(
              'DataTables_settings_' + location.pathname, JSON.stringify( data )
            );
          } catch (e) {
            // Same as fnStateLoadCallback.
          }
        },
        'columns': _.map(this.columnConfig, function(column){return column.options;})
      }, view.brecOptionsOverrides));
      this._extendOptions();
    },

    /**
     * Constructs an ajax call to retrieves the data to be used in the table. On a successful call,
     * process the data and update the table. In the event of an error, trigger the error function
     * and clear the table.
     * @private
     * @method _requestData
     * @param {Object} tableParams Parameters for the ajax request to retrieve the desired data
     * @param {Function} callback Required to be called by DataTables. Used to update display
     */
    _requestData : function(tableParams, callback) {
      var view = this;
      var collection = this.collection;
      view._updateColumnOrdering(tableParams);
      
      $.ajax({
        url: view.url,
        method: 'POST',
        contentType: 'application/json; charset=utf-8',
        dataType: 'json',
        data: JSON.stringify(tableParams),
        success: function(result) {
          view.trigger('successServerRetrieval');

          collection.fetchByIds(result.list).then(function() {
            callback(view._prepareData(tableParams, result));
            view.trigger('tableUpdateComplete');
          });
        },
        error: function() {
          view.trigger('errorServerRetrieval');

          callback(view._prepareData(tableParams));
          view.trigger('tableUpdateComplete');
        }
      });
    },


    // ----- Callback API ----------------------------------------------------------------------------------------------------------

    /**
     * Initializes the columns of the BREC table. Column information is used in both _translateData and _constructColumns.
     * columnInit should use _buildColumnConfig to properly format each column's information.
     * The ordering of these items is very important as it determines what will be sent out in the orderCol queryParam.
     * @method columnInit
     * @return {Object[]} Returns the information to be used in constructing the columns
     */
    columnInit: _.noop,

    /**
     * Specifies what to do when the server call is successful.
     * Default method may be overridden.
     * @method successfulServerRetrieval
     */
    successfulServerRetrieval: _.noop,

    /**
     * Specifies what to do when the server call is unsuccessful.
     * Default method may be overridden.
     * @method errorServerRetrieval
     */
    errorServerRetrieval: _.noop,

    /**
     * Makes updates to the table without having to reinitialize the widget.
     * @method tableUpdateComplete
     */
    tableUpdateComplete : function() {
      this._updateFixedHeaderPos();
    },


    // ----- Data Manipulation -----------------------------------------------------------------------------------------------------
    
    /**
     * The effect of this method is twofold. First it updates the view's history of column orderings.
     * Second it modifies the tableParams orderings to behave as a multicolumn ordering based off of the view's
     * history even on single ordering requests.
     * @private
     * @method _updateColumnOrdering
     * @param {Object} tableParams Parameters for the ajax request to retrieve the desired data
     */
    _updateColumnOrdering: function(tableParams) {
      var columnList = tableParams.order.map(function(order) {
        return order.column;
      });

      this.columnOrder = _.reject(this.columnOrder, function(columnData) {
        return _.contains(columnList, columnData.column);
      });

      this.columnOrder = tableParams.order.concat(this.columnOrder);
      tableParams.order = this.columnOrder.slice();
    },

    /**
     * Builds the column input to be in the format DataTables expects. For more information, see the
     * DataTables documentation at https://datatables.net/reference/option/columns
     * @private
     * @method buildColumnConfig
     * @param {String} label The id and name of the column
     * @param {Object} columnOptions Optional functions for columns with special formatting
     * @return {Object} The correctly formatted column input
     */
    _buildColumnConfig: function(label, columnOptions) {
      return {
        'label': label,
        'options': columnOptions || {'name': label}
      };
    },

    /**
     * Prepares the final representation of the data required by DataTables.
     * totalRecords is the total number of records after the server is done filtering,
     * but we are currently not doing any server-side filtering so it is equivalent to the total.
     * @private
     * @method _prepareData
     * @param {Object} tableParams Parameters for the ajax request to retrieve the desired data
     * @param {Object} result The result of the server retrieval; null if there was an error
     * @return {Object} Returns the processed data
     */
    _prepareData : function(tableParams, result) {
      var translatedData = [];
      var totalRecords = 0;

      if (result) {
        translatedData = this._translateData(result.list);
        totalRecords = result.fullListSize;
      }

      return {
        'data': translatedData,
        'recordsTotal': totalRecords,
        'recordsFiltered': totalRecords,
        'draw': parseInt(tableParams.draw)
      };
    },


    /*
     * Translates the entries that exist within the collection that have ids corresponding to ids in the given list.
     *
     * We need to translate the collection of objects that Torso will retrieve into a format that DataTables expects.
     * Instead of an array of objects with properties, DataTables requires an array of (array of objects) where the
     * (array of objects) is the equivalent to the model object containing properties.
     *
     * Note that we are doing idListOrder.map(). This allows us to use the variable we set aside that contained the
     * correct list order and preserve that ordering for our final data representation.
     *
     * @private
     * @method _translateData
     * @param {Number[]} idListOrder An array of longs with the ids of the objects to add in the desired order.
     * @return {Object[]} modelAsArray Returns the translated column information
     */
    _translateData: function(idListOrder) {
      var view = this;
      var columnInfo = _.map(this.columnConfig, function(column){return column.label;});
      return _.compact(idListOrder.map(function(modelId) {
        var model = view.collection.get(modelId);

        // DataTables can not handle empty or null objects in the array list.
        // Therefore, we should default to returning null if model does not exist and then filter those values out with compact.
        var modelAsArray = null;
        if (model) {
          // The ordering here is very important as it determines the ordering of cells in each table row.
          // Table cells will be placed from left to right in the same order as the attributes listed here.
          modelAsArray = [];
          for (var i=0; i<columnInfo.length; i++) {
            // Utilize handlebars helpers to escape the html
            modelAsArray.push(Handlebars.Utils.escapeExpression(model.get(columnInfo[i])));
          }
        }
        return modelAsArray;
      }));
    }

  });

  return brecView;
}));
