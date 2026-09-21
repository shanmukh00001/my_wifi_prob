' wifi_auto_login.vbs
' Silently runs the IIT(ISM) Wi-Fi Auto Login daemon in the background without any console window

Set objShell = CreateObject("WScript.Shell")
strPath = objShell.CurrentDirectory

' Get node.exe path and run index.js hidden (window style 0, false = do not wait)
objShell.Run "cmd /c node """ & strPath & "\index.js""", 0, False
