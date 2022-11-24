const selectBox = document.getElementById('selectBox') as HTMLSelectElement;
const canvas = document.getElementById('canvas') as HTMLCanvasElement;

type Path = []|[number, Path];

abstract class NodeType {
    abstract getText(): string;
}

class ExecNode extends NodeType {
    constructor(readonly msg: string, readonly path: Path) {
        super();
    }

    getText() { return this.msg; }
}

class BranchNode extends NodeType {
    constructor() {
        super();
    }

    getText() { return 'Branch'; }
}

class SuccessNode extends NodeType {
    constructor() {
        super();
    }

    getText() { return 'Success'; }
}

class ErrorNode extends NodeType {
    constructor() {
        super();
    }

    getText() { return 'Failure'; }
}

class ForestNode {
    constructor(readonly type: NodeType, readonly children: ForestNode[]) {}
}

type ExecutionForest = {msgs: string[], forest: string};

function deserializeForest({msgs, forest: forestString}: ExecutionForest): ForestNode[] {
    let i = 0;
    function consumeNode(path: Path, branchCounter: [number]): ForestNode {
        let childPath = path;
        let childBranchCounter = branchCounter;
        let type;
        switch (forestString.charCodeAt(i)) {
            case 35: { // #
                i++;
                const numberStart = i;
                i++;
                for (;;) {
                    const c = forestString.charCodeAt(i);
                    if (48 <= c && c <= 57) // digit
                        i++;
                    else
                        break;
                }
                const msgId = forestString.substring(numberStart, i);
                childPath = [branchCounter[0]++, path];
                childBranchCounter = [0];
                type = new ExecNode(msgs[+msgId], childPath);
                break;
            }
            case 66: // B
                i++;
                type = new BranchNode();
                break;
            case 83: // S
                i++;
                type = new SuccessNode();
                break;
            case 69: // E
                i++;
                type = new ErrorNode();
                break;
            default:
                throw new Error("Bad node type");
        }
        const children: ForestNode[] = [];
        if (forestString.charCodeAt(i) == 91) { // [ 
            i++;
            while (forestString.charCodeAt(i) != 93) // ]
                children.push(consumeNode(childPath, childBranchCounter));
            i++;
        } else
            children.push(consumeNode(childPath, childBranchCounter));
        return new ForestNode(type, children);
    }
    const result: ForestNode[] = [];
    const topBranchCounter: [number] = [0];
    while (i < forestString.length)
        result.push(consumeNode([], topBranchCounter));
    return result;
}

let currentForest: TreeNode[]|null = null;
//let lastMousePosition: [number, number]|null = null;

//canvas.onmousemove = event => { lastMousePosition = [event.offsetX, event.offsetY]; updateCanvas(); }
//canvas.onmouseleave = () => { lastMousePosition = null; updateCanvas(); }

type TreeNode = {type: NodeType, width: number, height: number, children: TreeNode[]};

const dotWidth = 15;
const dotRadius = dotWidth / 2;
const padding = 4;
const cw = dotWidth + 2 * padding;

function findNode(node: TreeNode, x: number, y: number): TreeNode|null {
    if (y < cw) {
        const px = node.width * cw / 2;
        const py = cw/2;
        if ((x - px) * (x - px) + (y - py) * (y - py) < dotWidth * dotWidth / 4)
            return node;
        else
            return null;
    }
    let childX = 0;
    let childY = cw;
    for (const child of node.children) {
        const nextChildX = childX + child.width * cw;
        if (x < nextChildX)
            return findNode(child, x - childX, y - childY);
        childX = nextChildX;
    }
    return null;
}

//const nodeLabelPadding = 2;

function updateCanvas() {
    if (currentForest != null && selectBox.selectedIndex >= 0) {
        debugger;
        const tree = currentForest[selectBox.selectedIndex];
        const ctxt = canvas.getContext('2d')!;
        // let hitNode = null;
        // let labelMetrics = null;
        // if (lastMousePosition != null) {
        //     const [x, y] = lastMousePosition;
        //     hitNode = findNode(tree, x, y);
        //     if (hitNode != null)
        //         labelMetrics = ctxt.measureText(hitNode.type.getText());
        // }
        // canvas.width = Math.max(tree.width * cw, hitNode == null ? 0 : lastMousePosition![0] + labelMetrics!.width + 2*nodeLabelPadding);
        canvas.width = tree.width * cw;
        canvas.height = tree.height * cw;
        const delayedCommands: (() => void)[] = [];
        function drawNode(x: number, y: number, node: TreeNode): [number, number, number] {
            const px = x + cw * node.width / 2;
            const py = y + cw / 2;
            const [outlineColor, fillColor] =
                node.type.constructor == ExecNode ?
                    [null, 'black']
                : node.type.constructor == BranchNode ?
                    node.children.length == 0 ?
                        ['black', 'lightgray']
                    :
                        [null, 'darkgray']
                : node.type.constructor == SuccessNode ?
                    [null, 'green']
                :
                    [null, 'red'];
            delayedCommands.push(() => {
                ctxt.fillStyle = fillColor;
                ctxt.beginPath();
                ctxt.arc(px, py, dotWidth / 2, 0, 2*Math.PI);
                ctxt.fill();
                if (outlineColor != null) {
                    ctxt.strokeStyle = outlineColor;
                    ctxt.beginPath();
                    ctxt.arc(px, py, dotWidth / 2, 0, 2*Math.PI);
                    ctxt.stroke();
                }
            });
            let childX = x;
            let childY = y + cw;
            for (const child of node.children) {
                const [w, cx, cy] = drawNode(childX, childY, child);
                ctxt.beginPath();
                ctxt.moveTo(px, py);
                ctxt.lineTo(cx, cy);
                ctxt.stroke();
                childX += w * cw;
            }
            return [node.width, px, py];
        }
        drawNode(0, 0, tree);
        for (const delayedCommand of delayedCommands)
            delayedCommand();
        // if (hitNode != null) {
        //     const [x, y] = lastMousePosition!;
        //     const padding = nodeLabelPadding;
        //     ctxt.fillStyle = 'white';
        //     const boxHeight = 2*padding + labelMetrics!.fontBoundingBoxAscent + labelMetrics!.fontBoundingBoxDescent;
        //     ctxt.fillRect(x, y - boxHeight, 2*padding + labelMetrics!.width, boxHeight);
        //     ctxt.fillStyle = 'black';
        //     ctxt.fillText(hitNode.type.getText(), x + padding, y - padding - labelMetrics!.fontBoundingBoxDescent);
        // }
    }
}

selectBox.onchange = updateCanvas;

function setCurrentForest(forestData: ExecutionForest) {
    function findFork(node: ForestNode): ForestNode {
        if (node.children.length == 1 && (node.children[0].type.constructor == ExecNode || node.type.constructor == BranchNode))
            return findFork(node.children[0]);
        return node;
    }
    function convert(forest: ForestNode[]): TreeNode[] {
        return forest.slice().map(node => {
            const children = convert(node.children.map(findFork));
            const width = Math.max(children.map(child => child.width).reduce((x, y) => x + y, 0), 1);
            const height = 1 + children.map(child => child.height).reduce((x, y) => Math.max(x, y), 0);
            return {type: node.type, width, height, children};
        });
    }
    const forest = currentForest = convert(deserializeForest(forestData));
    while (selectBox.firstChild != null)
        selectBox.removeChild(selectBox.firstChild);
    for (const tree of forest) {
        const option = document.createElement('option');
        const type = tree.type;
        if (!(type instanceof ExecNode)) throw new Error("Assertion failure");
        option.appendChild(document.createTextNode(type.msg));
        selectBox.appendChild(option);
    }

    updateCanvas();
}

function stringOfPath(path: Path) {
    const elems = [];
    let subpath = path;
    while (subpath.length > 0) {
        elems.push(subpath[0]);
        subpath = subpath[1]!;
    }
    return elems.join(',');
}

type WebViewVSCodeAPI = {postMessage(message: any): void};

declare function acquireVsCodeApi(): WebViewVSCodeAPI;

const vscode = acquireVsCodeApi();

canvas.onclick = event => {
    if (currentForest != null && selectBox.selectedIndex >= 0) {
        const tree = currentForest[selectBox.selectedIndex];
        const hitNode = findNode(tree, event.offsetX, event.offsetY);
        if (hitNode != null && hitNode.type instanceof ExecNode)
            vscode.postMessage(stringOfPath(hitNode.type.path));
    }
};

window.addEventListener('message', event => setCurrentForest(event.data));