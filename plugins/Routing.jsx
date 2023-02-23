/**
 * Copyright 2023 Sourcepole AG
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import {connect} from 'react-redux';
import PropTypes from 'prop-types';
import {createSelector} from 'reselect';
import FileSaver from 'file-saver';
import NumericInput from 'react-numeric-input2';
import {LayerRole, addLayerFeatures, removeLayer} from '../actions/layers';
import {zoomToExtent} from '../actions/map';
import {setCurrentTask} from '../actions/task';
import Icon from '../components/Icon';
import InputContainer from '../components/InputContainer';
import ButtonBar from '../components/widgets/ButtonBar';
import SearchWidget from '../components/widgets/SearchWidget';
import Spinner from '../components/Spinner';
import ResizeableWindow from '../components/ResizeableWindow';
import displayCrsSelector from '../selectors/displaycrs';
import CoordinatesUtils from '../utils/CoordinatesUtils';
import LocaleUtils from '../utils/LocaleUtils';
import MeasureUtils from '../utils/MeasureUtils';
import RoutingInterface from '../utils/RoutingInterface';
import './style/Routing.css';


class Routing extends React.Component {
    static propTypes = {
        active: PropTypes.bool,
        addLayerFeatures: PropTypes.func,
        displaycrs: PropTypes.string,
        enabledProviders: PropTypes.array,
        locatePos: PropTypes.array,
        mapcrs: PropTypes.string,
        removeLayer: PropTypes.func,
        searchProviders: PropTypes.object,
        setCurrentTask: PropTypes.func,
        windowSize: PropTypes.object,
        zoomToExtent: PropTypes.func
    }
    static defaultProps = {
        enabledProviders: ["coordinates", "nominatim"],
        windowSize: {width: 320, height: 320}
    }
    state = {
        visible: false,
        currentTab: 'Route',
        mode: 'auto',
        settings: {
            auto: {
                maxSpeed: 130
            },
            bus: {
                maxSpeed: 100
            },
            bicycle: {
                maxSpeed: 25
            },
            pedestrian: {
                maxSpeed: 4
            }
        },
        settingsPopup: false,
        routeConfig: {
            routepoints: [
                {text: '', pos: null, crs: null},
                {text: '', pos: null, crs: null}
            ],
            result: null
        },
        isoConfig: {
            point: {text: '', pos: null, crs: null},
            mode: 'time',
            intervals: '',
            result: null
        },
        searchProviders: [],
        searchParams: {}
    }
    constructor(props) {
        super(props);
        this.recomputeTimeout = null;
        this.state.searchProviders = props.enabledProviders.map(key => props.searchProviders[key]);
        this.state.searchParams = {
            mapcrs: this.props.mapcrs,
            displaycrs: this.props.displaycrs,
            lang: LocaleUtils.lang()
        };
    }
    componentDidUpdate(prevProps) {
        if (this.props.active && !prevProps.active) {
            this.setState({visible: true});
        }
    }
    render() {
        if (!this.state.visible) {
            return null;
        }
        const tabButtons = [
            {key: "Route", label: LocaleUtils.tr("routing.route")},
            {key: "Reachability", label: LocaleUtils.tr("routing.reachability")}
        ];
        const tabRenderers = {
            Route: this.renderRouteWidget,
            Reachability: this.renderIsochroneWidget
        };
        const buttons = [
            {key: "auto", icon: "routing-car", tooltip: "routing.mode_auto"},
            {key: "bus", icon: "routing-bus", tooltip: "routing.mode_bus"},
            {key: "bicycle", icon: "routing-bicycle", tooltip: "routing.mode_bicycle"},
            {key: "pedestrian", icon: "routing-walking", tooltip: "routing.mode_walking"}
        ];
        return (
            <ResizeableWindow icon="routing" initialHeight={this.props.windowSize.height} initialWidth={this.props.windowSize.width}
                onClose={this.onClose} title={LocaleUtils.tr("routing.windowtitle")} >
                <div role="body">
                    <ButtonBar active={this.state.currentTab} buttons={tabButtons} onClick={this.changeCurrentTab} />
                    <div className="routing-frame">
                        <div className="routing-buttons">
                            <ButtonBar active={this.state.mode} buttons={buttons} onClick={key => this.setState({mode: key})} />
                            <button className={"button" + (this.state.settingsPopup ? " pressed" : "")} onClick={() => this.setState({settingsPopup: !this.state.settingsPopup}, false)}>
                                <Icon icon="cog" />
                            </button>
                            {this.state.settingsPopup ? this.renderSettings() : null}
                        </div>
                        {tabRenderers[this.state.currentTab]()}
                    </div>
                </div>
            </ResizeableWindow>
        );
    }
    renderSettings = () => {
        return (
            <div className="routing-settings-menu">
                <div className="routing-settings-menu-entry">
                    <span>{LocaleUtils.tr("routing.maxspeed")}:</span>
                    <NumericInput
                        format={x => x + " km/h"} max={250} min={1} mobile
                        onChange={(value) => this.updateSetting(this.state.mode, {maxSpeed: value})}
                        precision={0} step={1} strict value={this.state.settings[this.state.mode].maxSpeed} />
                </div>
            </div>
        );
    }
    renderRouteWidget = () => {
        const routeConfig = this.state.routeConfig;
        const haveRoutePts = routeConfig.routepoints.filter(entry => entry.pos).length >= 2;
        return (
            <div>
                <div className="routing-routepoints">
                    <div>
                        {routeConfig.routepoints.map((entry, idx) => this.renderSearchField(entry, idx))}
                    </div>
                    <div>
                        <Icon icon="up-down-arrow" onClick={this.reverseRoutePts} />
                    </div>
                </div>
                <div>
                    <a href="#" onClick={this.addRoutePt}><Icon icon="plus" /> {LocaleUtils.tr("routing.add")}</a>
                </div>
                <div>
                    <button className="button routing-compute-button" disabled={routeConfig.busy || !haveRoutePts} onClick={this.computeRoute}>
                        {routeConfig.busy ? (<Spinner />) : null}
                        {LocaleUtils.tr("routing.compute")}
                    </button>
                </div>
                {routeConfig.result ? this.renderRouteResult(routeConfig) : null}
            </div>
        );
    }
    renderRouteResult = (routeConfig) => {
        if (routeConfig.result.success === false) {
            return (
                <div className="routing-status-failure">
                    {routeConfig.result.data.errorMsgId ? LocaleUtils.tr(routeConfig.result.data.errorMsgId) : routeConfig.result.data.error}
                </div>
            );
        } else {
            return (
                <div className="routing-result-summary">
                    <div><Icon icon="clock" /> {MeasureUtils.formatDuration(routeConfig.result.data.summary.time)}</div>
                    <div><Icon icon="measure" /> {MeasureUtils.formatMeasurement(routeConfig.result.data.summary.length * 1000, false)}</div>
                    <div><Icon icon="export" /> <a href="#" onClick={this.exportRoute}>{LocaleUtils.tr("routing.export")}</a></div>
                </div>
            );
        }
    }
    renderIsochroneWidget = () => {
        const isoConfig = this.state.isoConfig;
        const havePoint = isoConfig.point.pos !== null;
        const intervalValid = !!isoConfig.intervals.match(/^\d+(,\s*\d+)*$/);
        return (
            <div className="routing-frame">
                <div>
                    <InputContainer className="routing-search-field">
                        <SearchWidget resultSelected={(result) => this.isoSearchResultSelected(result)} role="input" searchParams={this.state.searchParams} searchProviders={this.state.searchProviders} value={isoConfig.point.text} />
                        <button className="button" disabled={!this.props.locatePos} onClick={() => this.updateRoutePoint(0, this.locatePos())} role="suffix">
                            <Icon icon="screenshot" />
                        </button>
                    </InputContainer>
                </div>
                <table className="routing-iso-settings">
                    <tbody>
                        <tr>
                            <td>{LocaleUtils.tr("routing.iso_mode")}: </td>
                            <td colSpan="2">
                                <select onChange={ev =>this.updateIsoConfig({mode: ev.target.value})} value={isoConfig.mode}>
                                    <option value="time">{LocaleUtils.tr("routing.iso_mode_time")}</option>
                                    <option value="distance">{LocaleUtils.tr("routing.iso_mode_distance")}</option>
                                </select>
                            </td>
                        </tr>
                        <tr>
                            <td>{LocaleUtils.tr("routing.iso_intervals")}: </td>
                            <td>
                                <input className={isoConfig.intervals && !intervalValid ? "routing-input-invalid" : ""} onChange={(ev) => this.updateIsoConfig({intervals: ev.target.value})} placeholder="5, 10, 15" type="text" value={isoConfig.intervals} />
                            </td>
                            <td>{isoConfig.mode === "time" ? "min" : "km"}</td>
                        </tr>
                    </tbody>
                </table>
                <div>
                    <button className="button routing-compute-button" disabled={isoConfig.busy || !havePoint || !intervalValid} onClick={this.computeIsochrone}>
                        {isoConfig.busy ? (<Spinner />) : null}
                        {LocaleUtils.tr("routing.compute")}
                    </button>
                </div>
                {isoConfig.result ? this.renderIsochroneResult(isoConfig) : null}
            </div>
        );
    }
    renderIsochroneResult = (isoConfig) => {
        if (isoConfig.result.success === false) {
            return (
                <div className="routing-status-failure">
                    {isoConfig.result.data.errorMsgId ? LocaleUtils.tr(isoConfig.result.data.errorMsgId) : isoConfig.result.data.error}
                </div>
            );
        }
        return null;
    }
    renderSearchField = (entry, idx) => {
        const numpoints = this.state.routeConfig.routepoints.length;
        return (
            <InputContainer className="routing-search-field" key={"field" + idx}>
                <SearchWidget resultSelected={(result) => this.routeSearchResultSelected(idx, result)} role="input" searchParams={this.state.searchParams} searchProviders={this.state.searchProviders} value={entry.text} />
                {idx === 0 ? (
                    <button className="button" disabled={!this.props.locatePos} onClick={() => this.updateRoutePoint(0, this.locatePos())} role="suffix">
                        <Icon icon="screenshot" />
                    </button>
                ) : null}
                {idx > 0 && idx < numpoints - 1 ? (
                    <button className="button" onClick={() => this.removeRoutePt(idx)} role="suffix">
                        <Icon icon="remove" />
                    </button>
                ) : null}
            </InputContainer>
        );
    }
    changeCurrentTab = (key) => {
        this.props.removeLayer("routingggeometries");
        this.setState({
            currentTab: key,
            routeConfig: {
                ...this.state.routeConfig,
                result: null
            }
        });
    }
    locatePos = () => {
        return {
            pos: [...this.props.locatePos],
            text: this.props.locatePos.map(x => x.toFixed(4)).join(", "),
            crs: 'EPSG:4326'
        };
    }
    updateSetting = (mode, diff) => {
        this.setState({settings: {
            ...this.state.settings,
            [mode]: {
                ...this.state.settings[mode],
                ...diff
            }
        }});
        this.recomputeIfNeeded();
    }
    addRoutePt = () => {
        this.setState({routeConfig: {
            ...this.state.routeConfig,
            routepoints: [
                ...this.state.routeConfig.routepoints.slice(0, -1),
                {text: '', pos: null},
                ...this.state.routeConfig.routepoints.slice(-1)
            ]
        }});
    }
    removeRoutePt = (idx) => {
        this.setState({routeConfig: {
            ...this.state.routeConfig,
            routepoints: [
                ...this.state.routeConfig.routepoints.slice(0, idx),
                ...this.state.routeConfig.routepoints.slice(idx + 1)
            ]
        }});
        this.recomputeIfNeeded();
    }
    reverseRoutePts = () => {
        this.setState({routeConfig: {
            ...this.state.routeConfig,
            routepoints: this.state.routeConfig.routepoints.reverse()
        }});
        this.recomputeIfNeeded();
    }
    updateRouteConfig = (diff, recompute = true) => {
        this.setState({routeConfig: {...this.state.routeConfig, ...diff}});
        if (recompute) {
            this.recomputeIfNeeded();
        }
    }
    updateRoutePoint = (idx, diff) => {
        this.setState({routeConfig: {
            ...this.state.routeConfig,
            routepoints: [
                ...this.state.routeConfig.routepoints.slice(0, idx),
                {...this.state.routeConfig.routepoints[idx], ...diff},
                ...this.state.routeConfig.routepoints.slice(idx + 1)
            ]
        }});
        this.recomputeIfNeeded();
    }
    updateIsoConfig = (diff, recompute = true) => {
        this.setState({isoConfig: {...this.state.isoConfig, ...diff}});
        if (recompute) {
            this.recomputeIfNeeded();
        }
    }
    onClose = () => {
        this.setState({visible: false});
        this.props.removeLayer("routingggeometries");
    }
    isoSearchResultSelected = (result) => {
        if (result) {
            this.updateIsoConfig({point: {text: result.text, pos: [result.x, result.y], crs: result.crs}});
        } else {
            this.updateIsoConfig({point: {text: "", pos: null, crs: null}});
        }
    }
    routeSearchResultSelected = (idx, result) => {
        if (result) {
            this.updateRoutePoint(idx, {text: result.text, pos: [result.x, result.y], crs: result.crs});
        } else {
            this.updateRoutePoint(idx, {text: "", pos: null, crs: null});
        }
    }
    computeRoute = () => {
        const locations = this.state.routeConfig.routepoints.filter(entry => entry.pos).map(entry => {
            return CoordinatesUtils.reproject(entry.pos, entry.crs, "EPSG:4326");
        });
        this.props.removeLayer("routingggeometries");
        this.updateRouteConfig({busy: true, result: null}, false);
        RoutingInterface.computeRoute(this.state.mode, locations, this.state.settings[this.state.mode], (success, result) => {
            if (success) {
                const layer = {
                    id: "routingggeometries",
                    role: LayerRole.SELECTION,
                    styleOptions: {
                        strokeColor: [10, 10, 255, 1],
                        strokeWidth: 4,
                        strokeDash: []
                    }
                };
                const features = result.legs.map(leg => ({
                    type: "Feature",
                    crs: "EPSG:4326",
                    geometry: {
                        type: "LineString",
                        coordinates: leg.coordinates
                    }
                }));
                this.props.addLayerFeatures(layer, features, true);
                this.props.zoomToExtent(result.summary.bounds, "EPSG:4326", -1);
            }
            this.updateRouteConfig({result: {success, data: result}, busy: false}, false);
        });
    }
    computeIsochrone = () => {
        const intervalValid = !!this.state.isoConfig.intervals.match(/^\d+(,\s*\d+)*$/);
        if (!intervalValid) {
            return;
        }
        const location = CoordinatesUtils.reproject(this.state.isoConfig.point.pos, this.state.isoConfig.point.crs, "EPSG:4326");
        this.props.removeLayer("routingggeometries");
        this.updateIsoConfig({busy: true, result: null}, false);
        const contourOptions = {
            mode: this.state.isoConfig.mode,
            intervals: this.state.isoConfig.intervals.split(",").map(entry => parseInt(entry.trim(), 10)).sort()
        };
        RoutingInterface.computeIsochrone(this.state.mode, location, contourOptions, this.state.settings[this.state.mode], (success, result) => {
            if (success) {
                const layer = {
                    id: "routingggeometries",
                    role: LayerRole.SELECTION,
                    styleOptions: {
                        strokeColor: [10, 10, 255, 1],
                        fillColor: [10, 10, 255, 0.5],
                        strokeWidth: 4,
                        strokeDash: []
                    }
                };
                const features = result.areas.map(area => ({
                    type: "Feature",
                    crs: "EPSG:4326",
                    geometry: {
                        type: "Polygon",
                        coordinates: [area]
                    }
                }));
                this.props.addLayerFeatures(layer, features, true);
                this.props.zoomToExtent(result.bounds, "EPSG:4326", -1);
            }
            this.updateIsoConfig({result: {success, data: result}, busy: false}, false);
        });
    }
    recomputeIfNeeded = () => {
        clearTimeout(this.recomputeTimeout);
        this.recomputeTimeout = setTimeout(() => {
            if (this.state.currentTab === "Route" && this.state.routeConfig.result) {
                this.computeRoute();
            } else if (this.state.currentTab === "Reachability" && this.state.isoConfig.result) {
                this.computeIsochrone();
            }
            this.recomputeTimeout = null;
        }, 750);
    }
    exportRoute = () => {
        const data = JSON.stringify({
            type: "FeatureCollection",
            features: this.state.routeConfig.result.data.legs.map(leg => ({
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: leg.coordinates
                }
            }))
        });
        FileSaver.saveAs(new Blob([data], {type: "text/plain;charset=utf-8"}), "route.json");
    }
}

export default (searchProviders) => {
    const providers = {...searchProviders, ...window.QWC2SearchProviders || {}};
    return connect(createSelector([state => state, displayCrsSelector], (state, displaycrs) => ({
        active: state.task.id === "Routing",
        mapcrs: state.map.projection,
        searchProviders: providers,
        displaycrs: displaycrs,
        locatePos: state.locate.position
    })), {
        addLayerFeatures: addLayerFeatures,
        removeLayer: removeLayer,
        setCurrentTask: setCurrentTask,
        zoomToExtent: zoomToExtent
    })(Routing);
};