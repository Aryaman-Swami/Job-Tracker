' Runs a PowerShell script with no visible window at all (window style 0), waiting for it to finish.
' Usage: wscript.exe run_hidden.vbs <script.ps1> [args...]
' Task Scheduler launching powershell.exe/python.exe/.bat directly flashes a console even with
' -WindowStyle Hidden; wscript is a GUI-subsystem host, so nothing appears.
Set sh = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & WScript.Arguments(0) & """"
For i = 1 To WScript.Arguments.Count - 1
    cmd = cmd & " " & WScript.Arguments(i)
Next
WScript.Quit sh.Run(cmd, 0, True)
