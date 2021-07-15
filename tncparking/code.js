'use strict';

/*
SFCTA PROSPECTOR: Data visualization platform.

Copyright (C) 2018 San Francisco County Transportation Authority
and respective authors. See Git history for individual contributions.

This program is free software: you can redistribute it and/or modify
it under the terms of the Apache License version 2.0, as published
by the Apache Foundation, or any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
See the Apache License for more details.

You should have received a copy of the Apache License along with
this program. If not, see <https://www.apache.org/licenses/LICENSE-2.0>.
*/

// IMPORTS-------------------------------------------------------------------

import 'isomorphic-fetch';
import 'lodash';
import vueSlider from 'vue-slider-component';
import Cookies from 'js-cookie';
import 'd3'

// MAP-----------------------------------------------------------------------

var maplib = require('../jslib/maplib');
let mymap = maplib.sfmap;
let zoomLevel = 13; 
mymap.setView([37.76889, -122.440997], zoomLevel);

let mapLegend;

let parkingLayer; 
let geoPopup;

// D3------------------------------------------------------------------------
var d3 = require("d3");

// VARIABLES-----------------------------------------------------------------

let chosenLocation = 'All';
const hourLabels =['12AM','1AM','2AM','3AM','4AM','5AM','6AM','7AM','8AM','9AM','10AM','11AM',
  'Noon','1PM','2PM','3PM','4PM','5PM','6PM','7PM','8PM','9PM','10PM','11PM'];

const dayLabels = ['All Week', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
                  'Friday', 'Saturday', 'Sunday']

const locationLabels = {'onstreet':'On-Street', 'offstreet':'Off-Street', 'All':'On-Street and Off-Street', 'None':'No Location Selection'}

let tnc_parking;
let geom_dict = {};

let selectedData;

let mapData;
var barData_daily; 
var barData_hourly; 

let selectedGeo;

let onstreet_color = 'rgb(36,125,189)' // old color: 'rgb(73,140,189)';
let offstreet_color = 'rgb(219,114,156)' // old color: 'rgb(219,135,168)';


// FUNCTIONS-----------------------------------------------------------------

function setup() {

  // Geographic details. 
  fetch('https://api.sfcta.org/api/parking_locations')
    .then((resp) => resp.json())
    .then(function(jsonData) {createGeoIDDict(jsonData)})
    .catch(function(error) {console.log('err:' + error)})
  // Temporal observations.
  fetch('https://api.sfcta.org/api/tnc_parking_v2')
    .then((resp) => resp.json())
    .then(function(jsonData) {
      tnc_parking = jsonData;
      selectedData = jsonData;
      updateBarData();
      buildMapData();
      updateLabels();
      summaryStatistics();
      buildTNCLayer();
      bar();
      //showSummaryStats();
    })
    .catch(function(error) {console.log('err:' + error)})

}

// DATA STRUCTURES-------------------------------------------------------------


function createGeoIDDict(json) {

  // Create geoid -> geometry, location_type mapping. 

  geom_dict = {}

  for (var i in json) {
    var element = json[i];
    var geom_id;
    if (element['location_type'] == 'onstreet') {
      geom_id = element['ab'];
    } else {
      geom_id = element['mazid'];
    }
    geom_dict[geom_id] = {'geometry':element['geometry'], 'location_type':element['location_type']}
  }
}


function updateSelectedData() {

  // Filter by: Day, Hour, Location
  selectedData = tnc_parking.filter(function(elem) {
    let filters = true;

    if (app.day != 0) {filters = filters && (elem.day == app.day-1)}; // Day
    if ((!app.isAllDay)) {filters = filters && (elem.hour == (app.sliderValue-1))}; // Hour
    if (chosenLocation != 'All') {filters = filters && (geom_dict[elem.geom_id].location_type == chosenLocation)}; // Location

    return filters
  });
  
  updateLabels();
  summaryStatistics();
  //showSummaryStats()
  updateBarData();
}


function updateBarData() {

  // DAILY (filter by hour, location, & selectedgeo) 
  barData_daily = tnc_parking.filter(function(elem) {
    let filters = true;
    if ((!app.isAllDay)) {filters = filters && (elem.hour == (app.sliderValue-1))}; // Hour
    if (chosenLocation != 'All') {filters = filters && (geom_dict[elem.geom_id].location_type == chosenLocation)}; // Location
    if (selectedGeo) {filters = filters && (elem.geom_id == selectedGeo)}; // Selected geo
    return filters
  });

  // HOURLY (filter by day, location, & selectedgeo)
  barData_hourly = tnc_parking.filter(function(elem) {
    let filters = true;
    if (app.day != 0) {filters = filters && (elem.day == app.day-1)}; // Day
    if (chosenLocation != 'All') {filters = filters && (geom_dict[elem.geom_id].location_type == chosenLocation)}; // Location
    if (selectedGeo) {filters = filters && (elem.geom_id == selectedGeo)}; // Selected geo
    return filters
  });
}


function buildMapData() {

  // Group by location, sum total duration & events, calculate avg. duration.

  mapData = {};

  for (let i in selectedData) {
    let elem = selectedData[i];

    // Initialize 
    if (!(elem['geom_id'] in mapData)) {
      mapData[elem['geom_id']] = {'geom_id': elem['geom_id'], 'total_duration':0, 'events':0, 'avg_duration':0, 'type': 'Feature', 
        'location_type':geom_dict[elem.geom_id].location_type, 'geometry':JSON.parse(geom_dict[elem.geom_id].geometry)}
    }

    // Increment values
    mapData[elem['geom_id']]['total_duration'] += elem.avg_total_minutes;
    mapData[elem['geom_id']]['events'] += elem.avg_events;

  }

  // Dict -> Array of objects
  mapData = Object.values(mapData)

  // Calculate average duration
  mapData.forEach(function(elem) {elem['avg_duration'] = elem['total_duration'] / elem['events'];})

  return mapData
}


function summaryStatistics() {

  // Reset values
  app.overall_duration = 0;
  app.overall_events = 0;

  for (let i in selectedData) {
    let elem = selectedData[i];
    if ((selectedGeo) && (elem.geom_id != selectedGeo)) {continue};
    // Increment totals.
    app.overall_duration +=  elem['avg_total_minutes']
    app.overall_events += elem['avg_events']
  }

  // Clean up
  if (app.overall_duration > 0) {
    app.overall_avgduration = tidyTime(app.overall_duration / app.overall_events);
    app.overall_duration = tidyTime(app.overall_duration);
    app.overall_events = numberWithCommas(app.overall_events.toFixed(0));
  } else {
    app.overall_avgduration = 0;
    app.overall_duration = 0;
    app.overall_events = 0;
  }
}

// CHARTS ----------------------------------------------------------------------------------------


function bar() {

  buildBarChart("day");
  buildBarChart("hour");
}


function buildBarChart(key) {

  //barData = selectedData;
  var barData = (key=='day') ? barData_daily : barData_hourly;

  // Group data by day and location type
  var chartData = {};

  // Initialize 
  var n = (key=='day') ? 7 : 24; 
  for (let i=0; i<n; i++) {
    chartData[i] = {'onstreet':0, 'offstreet':0}
    chartData[i][key] = i;
  }

  for (let i in barData) {
    let elem = barData[i];
    let locationtype = geom_dict[elem.geom_id]['location_type']
    // Increment onstreet or offstreet duration value
    chartData[elem[key]][locationtype] += elem['avg_total_minutes']/60
  }

  chartData = Object.values(chartData);

  // Abbreviate DOW
  for (let i in chartData) {chartData[i][key] = (key=='day') ? dayLabels[chartData[i][key]+1].substr(0,2) : hourLabels[chartData[i][key]];}

  // Set up SVG 
  var divid = (key=='day') ? 'div-daily' : 'div-hourly';

  var margin = {top: 20, right: 20, bottom: 35, left: 55};
  var width = document.getElementById(divid).clientWidth - margin.left - margin.right;
  var height = document.getElementById(divid).clientHeight - margin.top - margin.bottom;

  $('#'+divid).empty()

  var svg = d3.select('#'+divid)
    .append('svg')
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform",
            "translate(" + margin.left + "," + margin.top + ")");

  // x
  var x = d3.scaleBand()
    .domain(chartData.map(d => d[key]))
    .range([0, width])
    .padding(0.25)

  // x-axis
  svg.append("g")
    .attr("transform", "translate(0," + height + ")")
    .call(d3.axisBottom(x)
      .tickValues(x.domain().filter(function(d,i){ 
        if (key=='day') {return true}; // Include all tick values M-F
        return ['12AM', '3AM', '6AM', '9AM', 'Noon', '3PM', '6PM', '9PM'].includes(d); // Only include certain hours
      }))
    )
    .style('color', 'white');

  var keys = ["onstreet", "offstreet"]
  var stackGenerator = d3.stack().keys(keys);
  var layers = stackGenerator(chartData);

  // y
  var ymax = d3.max(layers, layer => d3.max(layer, sequence => sequence[1])); // (key=="day") ? 2000 : 200 
  if (selectedGeo) {ymax = d3.max(layers, layer => d3.max(layer, sequence => sequence[1]))}

  var y = d3.scaleLinear()
      .domain([0, ymax])
      .range([height, 0]);

  // y-axis
  svg.append("g")
      .call(d3.axisLeft(y)
        .ticks(4))
      .style('color', 'white');
  // y-axis label
  svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", -40)
      .attr("x", -height/2)
      .style("text-anchor", "middle")
      .style("fill", "white")
      .style("font-size", "12px")
      .attr("font-family", "Arial")
      .text("Duration (hours)");

  // Build stacked bars
  svg.selectAll(".layers")
    .data(layers)
    .join("g")
    .attr("class", "layers")
    .attr("fill", layer => {
      return (layer.key=='onstreet') ? onstreet_color : offstreet_color;
    })
    .selectAll("rect")
    .data(layer => layer)
    .join("rect")
    .attr("x", sequence => {return x(sequence.data[key])})
    .attr("width", x.bandwidth())
    .attr("y", sequence => y(sequence[1]))
    .attr("height", sequence => y(sequence[0]) - y(sequence[1]))
    .attr("fill", sequence => {
      // Grey out bars if necessary. 
      if ((key=='day') && (app.day!=0)) {
        if (dayLabels[app.day].substr(0,2) != sequence.data['day']) {
          return '#696969'
        }
      }
      if ((key=='hour') && (app.sliderValue!=0)) {
        if (hourLabels[app.sliderValue-1] != sequence.data['hour']) {
          return '#696969'
        }
      }
    })
}


function durationToBucket(duration) {
  if (duration<1) {return '0-1'}
  if ((duration>=1) && (duration<2)) {return '1-2'}
  if ((duration>=2) && (duration<3)) {return '2-3'}
  if ((duration>=3) && (duration<4)) {return '3-4'}
  if ((duration>=4) && (duration<5)) {return '4-5'}
  if (duration>=5) {return '5+'}
}

// MISC FUNCTIONS------------------------------------------------------------------------


function updateLabels() {

  // Location & Day.
  app.location_name = locationLabels[chosenLocation]; 
  app.summaryTitle = app.location_name + ' Parking'
  app.summarySubTitle = dayLabels[app.day] + ', ' + ((app.sliderValue==0) ? 'All Day' : hourLabels[app.sliderValue-1]);

}

function getLocationColor() {

  // Bar color
  if ((app.isOnStreetActive) && (app.isOffStreetActive)) { // ALL
    return '#8d8d8d';
  } else if (app.isOnStreetActive) { // ON STREET
    return onstreet_color;
  } else if (app.isOffStreetActive) { // OFF STREET
    return offstreet_color;
  } else { // NOTHING
    return '#8d8d8d';
  }
}

function numberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function tidyTimeTooltip(num) {
  if (num >= 60) {
    return numberWithCommas((minsToHours(num)).toFixed(2)) + ' hours'
  } else {
    return String(num.toFixed(2)) + ' minutes'
  }
}

function tidyTime(num) {
  if (num >= 60) {
    return numberWithCommas((minsToHours(num)).toFixed(0)) + ' hours'
  } else {
    return String(num.toFixed(2)) + ' minutes'
  }
}

function minsToHours(num) {
  var hours = (num / 60);
  var rhours = Math.floor(hours);
  var minutes = (hours - rhours) * 60;
  var rminutes = Math.round(minutes);
  return rhours + (rminutes/60)
}


// MAIN MAP--------------------------------

function circleColor(feature) {
  if (feature['location_type'] == 'onstreet') {
    return onstreet_color
  } else {
    return offstreet_color
  }
}

function getScalingFactor() {

  if (app.day == 0) {
    if (app.isAllDay) {
      var scaling_factor = .25 // All days, all hours
    } else {
      var scaling_factor = .8 // All days, sepecific hour
    }
  } else {
    if (app.isAllDay) {
      var scaling_factor = .5 // Specific day, all hours
    } else {
      var scaling_factor = 1.3 // Specific day, sepecific hour
    }
  }

  if (mymap.getZoom() > zoomLevel) {
    scaling_factor *= (mymap.getZoom()-zoomLevel+1)
  }

  return scaling_factor
}


mymap.on('zoomend', function() {
  buildTNCLayer()
});


function buildLegend() {

  // Remove previous legend. 
  if (mapLegend) {mymap.removeControl(mapLegend)};

  let max_radius = 20;
  let circle_radii = [max_radius, max_radius/1.3, max_radius/1.8, max_radius/2.5]
  let font_sizes = [15, 12, 11, 9]
  let scaling_factor = getScalingFactor();

  var lab = 'Total Duration (Hours)'

  mapLegend = L.control({position: 'bottomleft'});
  let labels = ['<b>' + lab + '</b>']

  mapLegend.onAdd = function(map) {

    let div = L.DomUtil.create('div', 'info legend');

    for (let i=0; i<4; i++) {

      let radius = circle_radii[i];
      let hrs = minsToHours((radius/scaling_factor)**2)
      let lab = (hrs>1) ? hrs.toFixed(0) : String(hrs.toFixed(2)).substr(1)
      labels.push(
        `
          <div class="legend-circle" 
               style="background:${getLocationColor()}; 
                      width: ${radius*2}px; 
                      height: ${radius*2}px;
                      font-size: ${font_sizes[i]}px;"> ${lab} 
          </div>
        `
      )
    }

    div.innerHTML = labels.join('<br>')

    return div
  }

  mapLegend.addTo(mymap)
}

function buildTNCLayer() {

  var scaling_factor = getScalingFactor();

  if (parkingLayer) {mymap.removeLayer(parkingLayer)};

  try {
    // Sort data so off-street locations appear on top of on-street locations.
    mapData.sort(function(a, b) {return b['location_type'].localeCompare(a['location_type'])});
  } catch (e) {
    // map data not built yet. 
  } 

  buildLegend();

  parkingLayer = L.geoJSON(mapData, {
    style: {"color": '#1279c6', "weight": 0.1, "opacity": 0.15},
    pointToLayer: function(feature, latlng) {
      return new L.CircleMarker(latlng, {radius: Math.sqrt(feature['total_duration'])*scaling_factor, 
                                         fillOpacity: 0.8,
                                         fillColor:circleColor(feature)});
    },
    onEachFeature: function(feature, layer) {
      layer.on({
        mouseover: hoverFeature,
        mouseout: hoverFeature,
        click: clickedOnFeature
      })
    }
  })

  parkingLayer.addTo(mymap);
}


function popupContent(e) {
  var loctype = (e.target.feature['location_type']=='offstreet') ? 'Off-Street' : 'On-Street';
  var day = dayLabels[app.day];
  var hour = (app.sliderValue==0) ? 'All Day' : hourLabels[app.sliderValue-1]

  // Tooltip text content
  var text = 
  `
  <h2 style="color:black; text-align:center; margin-bottom:5px; font-size:13px">` + String(e.target.feature.geom_id) + `</h4>
  <p style="color:black; text-align:center; margin-top:4px; margin-bottom:10px; font-size:12px;"><em>` + loctype + `</em></p>
  <table class="table table-striped">
    <caption font-size:14px;>` + day + `, ` + hour + `
    <tbody>
      <tr>
        <th scope="row">Total Duration</th>
        <td>` + tidyTimeTooltip(e.target.feature['total_duration']) + `</td>
      </tr>
      <tr>
        <th scope="row">Events</th>
        <td>` + e.target.feature['events'].toFixed(2) + `</td>
      </tr>
      <tr>
        <th scope="row">Average Duration</th>
        <td>` + tidyTimeTooltip(e.target.feature['avg_duration']) + `</td>
      </tr>
    </tbody>
  </table>
  `

  return text
}

function hoverFeature(e) {

  var text = popupContent(e);

  var radius_mult = 1.5;
  var stroke_width = 4; 

  if (!e.target.feature['clicked']) {
    // Determine how to alter the circle based on whether the event is mouseover or mouseout. 
    if (e.type == 'mouseout') {
      e.target.feature['hover'] = false;
      var opacity = 0.8
      radius_mult = 1 / radius_mult;
      stroke_width = 0; 
      // Tooltip
      mymap.removeControl(geoPopup)
    } else {
      e.target.feature['hover'] = true;
      var opacity = 0.9
      // Tooltip
      geoPopup = L.popup()
        .setLatLng(e.latlng)
        .setContent(text)
        .addTo(mymap)
    }
    
    // Highlight/un-highlight circle
    e.target.bringToFront();
    e.target.setStyle({
      'fillOpacity':opacity, 
      'radius':e.target._radius*radius_mult,
      'weight':stroke_width,
      'color':'#FFFFFF',
      'opacity':1,
      'className':'dot_selected',
      'mix-blend-mode':'normal'
    })

    e.target.bringToFront();
  }
}


function clickedOnFeature(e) {
  
  e.target.feature['clicked'] = true;

  var text = popupContent(e);

  selectedGeo = e.target.feature.geom_id;
  summaryStatistics();
  updateBarData();
  app.geoTitle = 'Location    ' + String(selectedGeo)
  bar();

  // Highlight
  let radius_mult = e.target.feature['hover'] ? 1 : 1.5;
  e.target.bringToFront();
  e.target.setStyle({
    'fillOpacity':1,
    'radius':e.target._radius*radius_mult
  })
  
  // Tooltip
  geoPopup = L.popup()
    .setLatLng(e.latlng)
    .setContent(text)
    .addTo(mymap)
    .on('remove', function() {
      e.target.feature['clicked'] = false
      selectedGeo = NaN; 
      updateBarData();
      summaryStatistics();
      app.geoTitle = "";
      bar();
      e.target.setStyle({
        'fillOpacity':0.8, 
        'radius':e.target._radius/1.5,
        'weight':0
      })
      e.target.feature['hover'] = false
    }) 


}

// BUTTON HANDLERS --------------------------

async function clickDay(chosenDay, silent=false) {
  app.day = parseInt(chosenDay)
  app.day_name = dayLabels[app.day];

  if (!silent) {play();} // Handle play button if Day was clicked by user
  updateSelectedData(); // Update selected data (for Chart & Map)
  buildMapData() // Update map data
  buildTNCLayer(); // Update map
  bar();

}

function setChosenLocation() {
  if (app.isOnStreetActive && app.isOffStreetActive) {
    chosenLocation='All'
  } else {
    if (app.isOnStreetActive) {
      chosenLocation='onstreet'
    } else if (app.isOffStreetActive) {
      chosenLocation='offstreet'
    } else {
      chosenLocation='None'
    }
  }
}

function pickOnStreet(thing) {

  document.getElementById("panel").click();
  
  // Update Variables
  app.isOnStreetActive = !app.isOnStreetActive;
  setChosenLocation();

  updateSelectedData(); // Update selected data (for Chart & Map)
  buildMapData() // Update map data
  buildTNCLayer(); // Update map

  bar()
}

function pickOffStreet(thing) {
  
  // Update Variables
  app.isOffStreetActive = !app.isOffStreetActive;
  setChosenLocation();

  updateSelectedData(); // Update selected data (for Chart & Map)
  buildMapData() // Update map data
  buildTNCLayer(); // Update map
  bar();
}

function sliderChanged(index, silent=false) {

  app.isAllDay = (index==0);
  app.hour_name = app.isAllDay ? 'All Day' : hourLabels[app.sliderValue-1];

  play();
  updateSelectedData();
  bar();
  buildMapData(); // Update map data
  buildTNCLayer(); // Update map

}


// PLAY -------------------------------------------------------------------------

// Store timeout IDs. 
var timeouts = [];

var playBoth = false; 

function killTimeouts() {
  for (var i=0; i < timeouts.length; i++) {
      clearTimeout(timeouts[i]);
  }
  timeouts = [];
}

function clickDOWPlay() {
  app.isPlayDOWActive = !app.isPlayDOWActive;
  play();
}

function clickTODPlay() {
  app.isPlayTODActive = !app.isPlayTODActive;
  play();
}

function play() {
  
  killTimeouts();

  if (app.isPlayDOWActive & app.isPlayTODActive) {
    playBoth = true;
    playTOD();
  } else {
    playBoth = false;
    if (app.isPlayDOWActive) {playDOW()}
    if (app.isPlayTODActive) {playTOD()}
  }

}

function playDOW(reset=false) {
  if ((app.day==0)) {clickDay(1, true)}; 
  var start_day = app.day;
  if ((reset==true)){
    start_day=0
  }
  var delay = 1000;
  // Play each day starting with start_day
  for (let day in [...Array(7 - start_day).keys()]) {
    day = parseInt(day) + 1 + start_day;
    timeouts.push(setTimeout(function(){clickDay(day, true);}, delay*(day-start_day)));
  }
  // Replay
  timeouts.push(setTimeout(function () {playDOW(true);}, delay*(7-start_day)))
}

function playTOD() {
  var delay = 1000; 
  var hr = app.sliderValue+1; 

  if (playBoth) {
    if (hr==25) {
      var day = parseInt(app.day)==7 ? 1 : parseInt(app.day)+1
      timeouts.push(setTimeout(function(){clickDay(day, true);}, delay))
    } else if (app.day == 0) {app.day=1}
  }
  if (hr==25) {hr=1;}; 

  timeouts.push(setTimeout(function(){app.sliderValue = hr}, delay))
}


//  VUE ELEMENTS------------------------------------------------------------------

let timeSlider = {
  min: 0,
  max: 24,
  width: 'auto',
  height: 3,
  dotSize: 16,
  tooltip: 'always',
  clickable: true,
  tooltipPlacement: 'bottom',
  marks: true,
  hideLabel: true,
  lazy: false,
  speed: 0.25,
  tooltipStyle: {"backgroundColor": 'grey', "borderColor": 'grey'},
  process: false,
  tooltipFormatter: idx => idx==0 ? 'Daily Total' : hourLabels[idx-1],
  style: {"marginTop":"10px","marginBottom":"30px","marginLeft":"10px","marginRight":"18px"},
};

document.getElementById("timeslider").style.cursor = "pointer"

let app = new Vue({
  el: '#panel',
  delimiters: ['${', '}'],
  data: {
    days: ['Weekly Total', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
    day: 0,
    day_name: 'All Week',
    hour_name: 'All Day',
    location_name: 'On-Street and Off-Street',
    isOnStreetActive: true,
    isOffStreetActive: true,
    isPlayDOWActive: false,
    isPlayTODActive: false,
    sliderValue: 0,
    timeSlider: timeSlider,
    isAllDay: true,
    summaryTitle: '',
    summarySubTitle: '',
    geoTitle: '',
    isPanelHidden: false,
    overall_duration: 0,
    overall_events: 0,
    overall_avgduration: 0
  },
  methods: {
    clickDay: clickDay,
    pickOnStreet: pickOnStreet, 
    pickOffStreet: pickOffStreet,
    clickDOWPlay: clickDOWPlay,
    clickTODPlay: clickTODPlay,
    getSliderValue: _.debounce(function() {sliderChanged(this.sliderValue);}, 30),
    clickToggleHelp: clickToggleHelp,
  },
  watch: {
    sliderValue: function(value) {
      this.getSliderValue();
    }
  }, 
  components: {
    vueSlider
  }
});

let slideapp = new Vue({
  el: '#slide-panel',
  delimiters: ['${', '}'],
  data: {
    isPanelHidden: false,
  },
  methods: {
    clickedShowHide: clickedShowHide,
  },
});

function clickedShowHide(e) {
  slideapp.isPanelHidden = !slideapp.isPanelHidden;
  app.isPanelHidden = slideapp.isPanelHidden;
  // leaflet map needs to be force-recentered, and it is slow.
  for (let delay of [50, 100, 150, 200, 250, 300, 350, 400, 450]) {
    setTimeout(function() {
      mymap.invalidateSize()
    }, delay)
  }
}

// eat some cookies -- so we can hide the help permanently
let cookieShowHelp = Cookies.get('showHelp');
function clickToggleHelp() {
  helpPanel.showHelp = !helpPanel.showHelp;

  // and save it for next time
  if (helpPanel.showHelp) {
    Cookies.remove('showHelp');
  } else {
    Cookies.set('showHelp', 'false', { expires: 365 });
  }
}

let helpPanel = new Vue({
  el: '#helpbox',
  data: {
    showHelp: cookieShowHelp == undefined,
  },
  methods: {
    clickToggleHelp: clickToggleHelp,
  },
  mounted: function() {
    document.addEventListener('keydown', e => {
      if (this.showHelp && e.keyCode == 27) {
        clickToggleHelp();
      }
    });
  },
});

// MAIN----------------------------------------------------------------------
setup();
