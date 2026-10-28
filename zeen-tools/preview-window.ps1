# Loaded by local-preview.ps1 after the exact executable/profile process guard.
if (-not ('YjtPreviewNativeWindow' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class YjtPreviewNativeWindow {
 public delegate bool Callback(IntPtr handle,IntPtr parameter);
 [DllImport("user32.dll",SetLastError=true)] static extern bool EnumWindows(Callback callback,IntPtr parameter);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr handle,StringBuilder text,int max);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr handle,StringBuilder text,int max);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
 [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr handle);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr handle,uint command);
 [DllImport("user32.dll",SetLastError=true)] static extern bool PostMessage(IntPtr handle,uint message,IntPtr wParam,IntPtr lParam);
 public class Item { public uint pid;public long handle;public string title;public string className;public bool visible;public bool enabled;public long owner; }
 public static long Select(Item[] windows,uint pid,bool requireVisible) {
  Item chosen=null;
  foreach(var item in windows) {
   if(item.pid!=pid||item.owner!=0||item.className!="Chrome_WidgetWin_1"||
    (item.title!="一键投递 · LOCAL PREVIEW"&&item.title!="一键投递 · LOCAL PREVIEW · AI DEBUG"))continue;
   if(chosen!=null)throw new InvalidOperationException("Multiple preview windows; original process retained.");
   chosen=item;
  }
  if(chosen==null||!chosen.enabled||(requireVisible&&!chosen.visible))return 0;
  return chosen.handle;
 }
 public static Item[] Read(uint target) {
  var windows=new List<Item>();
  if(!EnumWindows((handle,parameter)=>{
   uint pid;GetWindowThreadProcessId(handle,out pid);
   if(pid==target){var text=new StringBuilder(1024);var name=new StringBuilder(256);GetWindowText(handle,text,text.Capacity);GetClassName(handle,name,name.Capacity);
    windows.Add(new Item{pid=pid,handle=handle.ToInt64(),title=text.ToString(),className=name.ToString(),visible=IsWindowVisible(handle),enabled=IsWindowEnabled(handle),owner=GetWindow(handle,4).ToInt64()});}
   return true;
  },IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error());
  return windows.ToArray();
 }
 public static long ReadyHandle(uint pid){return Select(Read(pid),pid,true);}
 public static bool Close(uint pid) {
  var handle=Select(Read(pid),pid,false);if(handle==0)return false;
  // Revalidate identity and modal state immediately before WM_CLOSE. No Kill,
  // taskkill, blank-window fallback or timeout escalation.
  if(Select(Read(pid),pid,false)!=handle)return false;
  return PostMessage(new IntPtr(handle),0x0010,IntPtr.Zero,IntPtr.Zero);
 }
}
'@
}
