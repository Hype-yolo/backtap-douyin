#!/usr/bin/env python3
"""Build an inspectable iOS Shortcut. Signing is a separate macOS command.

No keys or per-user URLs belong in the published artifact. Users configure the
two Text actions in the editor after import. The clipboard is read only when manually triggered.
"""
import argparse
import json
import plistlib
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parents[1]

def uid():
    return str(uuid.uuid4()).upper()

def output(action_id, name):
    return {"Type": "ActionOutput", "OutputUUID": action_id, "OutputName": name}

def variable(name):
    return {"Type": "Variable", "VariableName": name}

def attachment(value):
    return {"Value": value, "WFSerializationType": "WFTextTokenAttachment"}

def condition_input(value):
    return {"Type":"Variable","Variable":attachment(value)}

def text(*parts):
    string, attachments = "", {}
    for part in parts:
        if isinstance(part, dict):
            offset = len(string.encode("utf-16-le")) // 2
            attachments[f"{{{offset}, 1}}"] = part
            string += "\ufffc"
        else:
            string += part
    return {"Value": {"string": string, "attachmentsByRange": attachments}, "WFSerializationType": "WFTextTokenString"}

def headers(values):
    items = []
    for key, value in values.items():
        items.append({"WFItemType": 0, "WFKey": text(key), "WFValue": value if isinstance(value, dict) else text(value)})
    return {"Value": {"WFDictionaryFieldValueItems": items}, "WFSerializationType": "WFDictionaryFieldValue"}

def build(endpoint="https://your-server.example", name="轻点下载", public=False):
    actions=[]
    def add(identifier, **parameters):
        action_id=uid()
        parameters["UUID"]=action_id
        actions.append({"WFWorkflowActionIdentifier": "is.workflow.actions."+identifier,"WFWorkflowActionParameters":parameters})
        return action_id
    add("comment",WFCommentActionText="先复制抖音视频链接，再运行本指令。设置 → 辅助功能 → 触控 → 轻点背面 → 轻点两下，选择本指令。仅在运行时读取剪贴板；只向你配置的服务发送匹配到的抖音链接。首次运行需允许网络、粘贴及存入照片。")
    server=add("gettext",WFTextActionText=endpoint)
    add("setvariable",WFVariableName="服务地址",WFInput=attachment(output(server,"Text")))
    key=add("gettext",WFTextActionText="" if public else "填写你的服务密钥")
    add("setvariable",WFVariableName="服务密钥",WFInput=attachment(output(key,"Text")))
    clip=add("getclipboard")
    match=add("text.match",WFMatchTextPattern=r"https?://(?:(?:v|www)\.)?(?:douyin\.com|iesdouyin\.com)/[^\s<>\"\]\[，。！？）]+",text=text(output(clip,"Clipboard")))
    first=add("getitemfromlist",WFItemSpecifier="First Item",WFInput=attachment(output(match,"Matches")))
    group=uid()
    add("conditional",GroupingIdentifier=group,WFControlFlowMode=0,WFCondition=100,WFInput=condition_input(output(first,"Item from List")))
    encoded=add("urlencode",WFEncodeMode="Encode",WFInput=text(output(first,"Item from List")))
    request_url=add("gettext",WFTextActionText=text(variable("服务地址"),"/v1/resolve?url=",output(encoded,"URL Encoded Text")))
    response=add("downloadurl",WFURL=text(output(request_url,"Text")),WFHTTPMethod="GET",WFHTTPHeaders=headers({} if public else {"Authorization":text("Bearer ",variable("服务密钥"))}))
    video=add("getvalueforkey",WFDictionaryKey="video_url",WFInput=attachment(output(response,"Contents of URL")))
    inner=uid()
    add("conditional",GroupingIdentifier=inner,WFControlFlowMode=0,WFCondition=100,WFInput=condition_input(output(video,"Dictionary Value")))
    data=add("downloadurl",WFURL=text(output(video,"Dictionary Value")),WFHTTPMethod="GET",WFHTTPHeaders=headers({"Referer":"https://www.douyin.com/"}))
    named=add("setitemname",WFName="抖音视频.mp4",WFInput=attachment(output(data,"Contents of URL")))
    add("savetocameraroll",WFInput=attachment(output(named,"Renamed Item")))
    add("notification",WFNotificationActionTitle="轻点下载",WFNotificationActionBody="视频已保存到相册。",WFNotificationActionSound=False)
    add("conditional",GroupingIdentifier=inner,WFControlFlowMode=1)
    error=add("getvalueforkey",WFDictionaryKey="error.message",WFInput=attachment(output(response,"Contents of URL")))
    add("alert",WFAlertActionTitle="这次没有下载成功",WFAlertActionMessage=text("请检查服务地址、密钥和网络。服务返回：",output(error,"Dictionary Value")),WFAlertActionCancelButtonShown=False)
    add("conditional",GroupingIdentifier=inner,WFControlFlowMode=2)
    add("conditional",GroupingIdentifier=group,WFControlFlowMode=1)
    add("alert",WFAlertActionTitle="还没有抖音链接",WFAlertActionMessage="请先在抖音点“分享 → 复制链接”，然后再轻点两下背面。",WFAlertActionCancelButtonShown=False)
    add("conditional",GroupingIdentifier=group,WFControlFlowMode=2)
    return {
        "WFWorkflowName":name,"WFWorkflowClientVersion":"2700","WFWorkflowMinimumClientVersion":900,
        "WFWorkflowMinimumClientVersionString":"900","WFWorkflowIcon":{"WFWorkflowIconStartColor":4282601983,"WFWorkflowIconGlyphNumber":59511},
        "WFWorkflowTypes":[],"WFWorkflowInputContentItemClasses":[],"WFWorkflowOutputContentItemClasses":[],
        "WFQuickActionSurfaces":[],"WFWorkflowHasShortcutInputVariables":False,
        "WFWorkflowImportQuestions":[],
        "WFWorkflowActions":actions,
    }

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--endpoint",default="https://your-server.example")
    parser.add_argument("--name",default="轻点下载")
    parser.add_argument("--public",action="store_true",help="Use an explicitly enabled public service; no key or setup questions.")
    parser.add_argument("--output",default=str(ROOT/"shortcuts/轻点下载.unsigned.shortcut"))
    args=parser.parse_args()
    workflow=build(args.endpoint.rstrip('/'),args.name,args.public)
    destination=Path(args.output)
    destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_bytes(plistlib.dumps(workflow,fmt=plistlib.FMT_BINARY,sort_keys=False))
    (ROOT/"shortcuts/workflow.json").write_text(json.dumps(workflow,ensure_ascii=False,indent=2)+"\n")
    print(f"Built {len(workflow['WFWorkflowActions'])} actions: {destination}")

if __name__=="__main__":main()
