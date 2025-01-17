import * as React from "react";
import { Subscription } from "rxjs";
import { CommandBase } from "./commands/command-base";
import { CommandSetJoints } from "./commands/command-set-joints";
import { CommandSetTag } from "./commands/command-set-tag";
import { IOperatorProps, RobotData, RobotImageData, RobotState } from "./entities";
import { IImageReceiver, WebSocketImageReceiver } from "./image-receiver";
import { INetworkOperator, NetworkOperator } from "./network-operator";
import "./operator-debug.scss";


interface IOperatorState {
    wsUrl: string,
    robotName: string,
    accessToken: string,
    depthData: string,
    imageData: string,
    fps: number,
    connected: boolean,
    isCalibrating: boolean,
    tagsCalibrated: {[tag: string]: boolean},
    joints: number[],
}

export class OperatorDebug extends React.Component<IOperatorProps, IOperatorState> {

    private _imageReceiver: IImageReceiver;
    private _networkOperator: INetworkOperator;

    private subscriptions: Subscription[] = [];

    private lastFrameDate = Date.now();
    private robotData: RobotData;
    private robotState: RobotState;

    constructor(props: IOperatorProps) {
        super(props);

        let tags = [6, 8, 11, 12];
        let tagSets = {};
        tags.map(t => tagSets[t] = false);
        
        this.state = {
            wsUrl: this.props.dataWSUrl,
            robotName: this.props.robotName,
            accessToken: this.props.accessToken,
            fps: 0,
            depthData: undefined,
            imageData: undefined,
            connected: false,
            isCalibrating: false,
            tagsCalibrated: tagSets,
            joints: [],
        }
    }

    connectionSettingChanged(e: React.ChangeEvent<HTMLInputElement>) {
        this.setState({
            ...this.state,
            [e.target.name]: e.target.value});
    }

    componentWillUnmount() {
        this.disconnect();
    }

    connect() {
        // console.log(this.state);
        let settings = {
            accessToken: this.state.accessToken,
            dataWSUrl: this.state.wsUrl,
            robotName: this.state.robotName
        };
        let netop = new NetworkOperator(settings);
        let imgrec = new WebSocketImageReceiver(settings);

        this.subscriptions.push(imgrec.imageSubject.subscribe(camera => this.gotCameraData(camera)));
        this.subscriptions.push(imgrec.depthSubject.subscribe(depth => this.gotDepthData(depth)));
        this.subscriptions.push(imgrec.stateSubject.subscribe(state => this.gotRobotState(state)));
        this.subscriptions.push(imgrec.dataSubject.subscribe(data => this.gotRobotData(data)));

        this._imageReceiver = imgrec;
        this._networkOperator = netop;

        this.setState({connected: true});
    }

    disconnect() {
        this._networkOperator?.shutdown();
        this._imageReceiver?.shutdown();
        this.subscriptions.forEach(s => s.unsubscribe());
        this.subscriptions = [];
        this.setState({
            connected: false,
            isCalibrating: false,
            joints: [],
        });
    }

    gotCameraData(cameraData: RobotImageData) {
        if (cameraData === undefined) return;
        let buf = cameraData.data.toString('base64');
        this.setState({imageData: `data:${cameraData.type};base64,`+buf});
        this.recalculateFPS();
    }

    recalculateFPS() {
        const newFrameDate = Date.now();
        const delta = newFrameDate - this.lastFrameDate;
        const fps = 1000 / delta;
        this.lastFrameDate = newFrameDate;
        this.setState({fps: fps});
    }

    gotDepthData(depthData: any) {
        const type = "image/png";
        depthData.multiply(64); // Multiply by 2**8 to move it from 16bit to browser-visible 8bit space
        let buf = depthData.toBase64();
        this.setState({depthData: `data:${type};base64,`+buf});
    }

    gotRobotState(state: RobotState) {
        if (state === undefined) return;
        // console.log("State:", state);
        this.robotState = state;
        if (this.robotState.joints) {
            this.setState({joints: state.joints});
        }
    }

    gotRobotData(data: RobotData) {
        if (data === undefined) return;
        // console.log("Data:", data);
        this.robotData = data;
    }

    calibrationStart() {
        this.sendOp("ask_for_manual");
        this.sendOp("calibration/tag_detection");
        this.resetTagState();
        this.setState({isCalibrating: true});
    }

    canFinishCalibration() {
        if (!this.state.isCalibrating) return false;
        const tags = this.state.tagsCalibrated;
        const unset = Object.keys(tags).filter(t => !tags[t]);
        return unset.length == 0;
    }
    
    finishCalibration() {
        this.sendOp("calibartion/tag_calibration");
        this.sendOp("ask_for_idle");
        this.resetTagState();
        this.setState({isCalibrating: false});
    }

    resetTagState() {
        let tags = this.state.tagsCalibrated;
        Object.keys(tags).forEach(t => tags[t] = false);
        this.setState({tagsCalibrated: tags});
    }
    
    detectCalibrationTags() {
        this.sendOp("calibration/tag_detection");
    }

    tagClicked(tag: string) {
        // Send the command
        let cmd = new CommandSetTag(Number(tag), this.robotData);
        this._networkOperator.enqueueCommand(cmd);
        // Setting this tag as clicked
        let tags = this.state.tagsCalibrated;
        tags[tag] = true;
        this.setState({tagsCalibrated: tags});
    }

    renderTagButtons() {
        const tags = Object.keys(this.state.tagsCalibrated);
        let tagObjs = tags.map(tag => 
            <button onClick={() => this.tagClicked(tag)}
                    key={tag}
                    disabled={!this.state.isCalibrating}>
                {this.state.tagsCalibrated[tag] ? "Reset" : "Tag"} #{tag}
            </button>
        );
        return (
            <div className="tags"
                 style={{gridTemplateColumns: "repeat(" + tags.length + ", 1fr)"}}>
                {tagObjs}
            </div>
        );
    }

    renderJoints() {
        if (this.state.joints.length == 0) return undefined;
        let jointControls = this.state.joints.map((j, i) => 
            <div key={i} className="joint-controls">
                <div className="joint-num">{i}:</div>
                <button onClick={() => this.moveJoint(i, -15)}>-15°</button>
                <button onClick={() => this.moveJoint(i, -5)}>-5°</button>
                <div className="joint-degrees">{this.radianToDegrees(j).toFixed(2)}°</div>
                <button onClick={() => this.moveJoint(i, 5)}>+5°</button>
                <button onClick={() => this.moveJoint(i, 15)}>+15°</button>
            </div>
        );

        return (<div>
            <span>Joints</span>
            <div className="input-container">
                {jointControls}
            </div>
            </div>
        );
    }

    moveJoint(jointNum: number, degrees: number) {
        // All joint values are sent out in degrees
        let joints = this.state.joints.map(j => this.radianToDegrees(j));
        joints[jointNum] += degrees;
        // joints[jointNum] += this.degreesToRadian(degrees);
        let cmd = new CommandSetJoints(joints, this.robotData);
        this._networkOperator.enqueueCommand(cmd);
        // console.log(joints);
    }

    radianToDegrees = (rad: number) => rad * 180 / Math.PI;
    degreesToRadian = (deg: number) => deg * Math.PI / 180;


    sendOp = (op: string) => this._networkOperator.enqueueCommand(
        new CommandBase(op, this.robotData)
    );

    sendOpClosure = (op: string) => () => this.sendOp(op);

    render() {
        return (
            <div className="debug-operator-container">
                <div className="camera-view">
                    <img width="1280" height="720"
                         src={this.state.imageData}/>
                </div>
                <div className="controls">
                <span>Connection</span>
                <div className="input-container connection">
                    <span>Url:</span>
                    <input name="wsUrl"
                           value={this.state.wsUrl}
                           onChange={(e) => this.connectionSettingChanged(e)}/>
                    <span>Robot:</span>
                    <input name="robotName"
                           value={this.state.robotName} 
                           onChange={(e) => this.connectionSettingChanged(e)}/>
                    {/* <span>Token:</span>
                    <input name="accessToken"
                           value={this.state.accessToken} 
                           onChange={(e) => this.connectionSettingChanged(e)}/> */}
                    <button onClick={() => this.disconnect()}
                            disabled={!this.state.connected}>
                        Disconnect
                    </button>
                    <button onClick={() => this.connect()}
                            disabled={this.state.connected}>
                        Connect
                    </button>
                </div>
                <div className="operator-buttons">

                    {this.renderJoints()}

                    <span>Vacuum</span>
                    <div className="input-container vacuum">
                        <button onClick={this.sendOpClosure("manual_vacuum_on")}
                                disabled={!this.state.connected}>
                            On
                        </button>
                        <button onClick={this.sendOpClosure("manual_vacuum_off")}
                                disabled={!this.state.connected}>
                            Off
                        </button>
                    </div>
                    <span>Calibration</span>
                    <div className="input-container calibration">
                        <div>
                            <button onClick={() => this.calibrationStart()}
                                    disabled={!this.state.connected}>
                                Start calibration
                            </button>
                            <button onClick={this.sendOpClosure("calibration/tag_detection")}
                                    disabled={!this.state.connected}>
                                Detect tags
                            </button>
                        </div>
                        {this.renderTagButtons()}
                        <div>
                            <button onClick={() => this.finishCalibration()}
                                    disabled={!this.canFinishCalibration()}>
                                Finish calibration
                            </button>
                        </div>
                    </div>
                    <div>
                        <span>{`FPS: ${this.state.fps.toFixed(2)}`}</span>
                    </div>
                </div>
                <div>
                    <button className="btn-send-home"
                            onClick={this.sendOpClosure("go_home_safely")}
                            disabled={!this.state.connected}>
                        Send home
                    </button>
                </div>
                <div className="depth-view">
                    <img width="320" height="180"
                         src={this.state.depthData}/>
                </div>
            </div>
        </div>
        )
    }
}