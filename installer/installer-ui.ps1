param(
  [string]$InstallerPath,
  [string]$InstallDir,
  [string]$Version,
  [string]$LocationReason,
  [int]$DesktopDefault = -1,
  [long]$PayloadBytes = 234000000,
  [switch]$Preview,
  [switch]$PreviewFolder,
  [ValidateSet('setup','progress','finish')][string]$PreviewScreen = 'setup',
  [string]$CapturePath,
  [switch]$Acceptance,
  [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
trap {
 $message=$_.Exception.Message
 try{[IO.File]::WriteAllText((Join-Path $env:TEMP 'yijian-installer-error.log'),$_.ToString())}catch{}
 if($Acceptance){@{status='failed';message=$message}|ConvertTo-Json|Set-Content -LiteralPath $ReportPath -Encoding UTF8;exit 1}
 [void][Windows.MessageBox]::Show('安装界面暂时无法启动，请重新打开安装包。'+[Environment]::NewLine+$message,'一键投递')
 exit 1
}
$script:installing = $false
$script:installed = $false
$script:process = $null
$script:timer = $null
$script:exitCode = 0
$script:startedAt = $null
function Find-RegisteredInstall([object[]]$Rows) {
 foreach($row in $Rows) {
  if($row.DisplayName -notmatch '^一键投递(?: \d+\.\d+\.\d+)?$'){continue}
  $icon=([string]$row.DisplayIcon -replace ',\s*-?\d+$','').Trim('"')
  try {
   if(-not [IO.Path]::IsPathRooted($icon) -or [IO.Path]::GetFileName($icon) -ne '一键投递.exe' -or -not [IO.File]::Exists($icon)){continue}
   return @{Root=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($icon));Version=[string]$row.DisplayVersion}
  } catch {continue}
 }
 return $null
}
if (-not $InstallDir) {
 $record=Find-RegisteredInstall @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue)
 if ($record.Root) {$InstallDir=$record.Root;$LocationReason='沿用已有安装位置，保留简历、登录与设置。'}
 else {
  $InstallDir=Join-Path $env:LOCALAPPDATA 'Programs\yijian-toudi';$LocationReason='没有合适的其他磁盘，使用当前用户目录，也可以手动选择。'
  foreach($drive in [IO.DriveInfo]::GetDrives()) {
   if(!$drive.IsReady -or $drive.DriveType -ne 'Fixed' -or $drive.Name.Substring(0,2) -eq $env:SystemDrive -or $drive.AvailableFreeSpace -lt 2000000000){continue}
   $InstallDir=Join-Path $drive.Name 'Applications\Laoyu\YijianToudi';$LocationReason='优先推荐非系统盘（点击安装时检查写入权限）；可点击更换位置。';break
  }
 }
}
# An upgrade retains the existing desktop preference. No registry/files are changed during preview.
if($DesktopDefault -lt 0){
 $DesktopDefault=0
 $preference=Get-ItemProperty -LiteralPath 'HKCU:\Software\3c9e6782-3db2-56c2-b59b-7731dce81b79' -ErrorAction SilentlyContinue
 if($null -ne $preference.DesktopShortcut){$DesktopDefault=[int]$preference.DesktopShortcut}
 elseif([IO.File]::Exists((Join-Path ([Environment]::GetFolderPath('Desktop')) '一键投递.lnk'))){$DesktopDefault=1}
}
$script:selectedPath = $InstallDir
$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
  Title="一键投递 · 安装" Width="860" Height="550" WindowStyle="None" ResizeMode="NoResize" AllowsTransparency="True" Background="Transparent" WindowStartupLocation="CenterScreen" FontFamily="Microsoft YaHei UI" FontSize="13">
 <Window.Resources>
  <Style TargetType="ScrollBar"><Setter Property="Width" Value="7"/><Setter Property="Background" Value="Transparent"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="ScrollBar"><Grid Background="Transparent"><Track x:Name="PART_Track" Orientation="Vertical" IsDirectionReversed="True"><Track.DecreaseRepeatButton><RepeatButton Command="ScrollBar.PageUpCommand" Opacity="0" Focusable="False"/></Track.DecreaseRepeatButton><Track.Thumb><Thumb><Thumb.Template><ControlTemplate TargetType="Thumb"><Border x:Name="ThumbSurface" Background="#C3BBE9" CornerRadius="3" Margin="1,0"/><ControlTemplate.Triggers><Trigger Property="IsMouseOver" Value="True"><Setter TargetName="ThumbSurface" Property="Background" Value="#9D8DD8"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Thumb.Template></Thumb></Track.Thumb><Track.IncreaseRepeatButton><RepeatButton Command="ScrollBar.PageDownCommand" Opacity="0" Focusable="False"/></Track.IncreaseRepeatButton></Track></Grid></ControlTemplate></Setter.Value></Setter></Style>
  <Style TargetType="Button"><Setter Property="Cursor" Value="Hand"/><Setter Property="Foreground" Value="#5545AE"/><Setter Property="Background" Value="#EEEEE5"/><Setter Property="Padding" Value="18,11"/><Setter Property="BorderThickness" Value="0"/>
   <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Button"><Border x:Name="Surface" Background="{TemplateBinding Background}" CornerRadius="10" Padding="{TemplateBinding Padding}"><ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/></Border><ControlTemplate.Triggers><Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Surface" Property="Opacity" Value="0.85"/></Trigger><Trigger Property="IsPressed" Value="True"><Setter TargetName="Surface" Property="Opacity" Value="0.65"/></Trigger><Trigger Property="IsEnabled" Value="False"><Setter TargetName="Surface" Property="Opacity" Value="0.45"/></Trigger><Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="Surface" Property="BorderBrush" Value="#A8BEAF"/><Setter TargetName="Surface" Property="BorderThickness" Value="2"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter>
  </Style>
  <Style TargetType="CheckBox"><Setter Property="Foreground" Value="#52655B"/><Setter Property="Cursor" Value="Hand"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="CheckBox"><StackPanel Orientation="Horizontal"><Border x:Name="Box" Width="19" Height="19" CornerRadius="5" BorderThickness="1" BorderBrush="#B7C0B5" Background="#FFFFFF" Margin="0,0,9,0"><Path x:Name="Tick" Data="M 4,9 L 8,13 L 15,5" Stroke="White" StrokeThickness="2" Visibility="Collapsed"/></Border><ContentPresenter VerticalAlignment="Center"/></StackPanel><ControlTemplate.Triggers><Trigger Property="IsChecked" Value="True"><Setter TargetName="Box" Property="Background" Value="#5545AE"/><Setter TargetName="Box" Property="BorderBrush" Value="#5545AE"/><Setter TargetName="Tick" Property="Visibility" Value="Visible"/></Trigger><Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="Box" Property="BorderThickness" Value="2"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
  <Style TargetType="TextBox"><Setter Property="Padding" Value="13,12"/><Setter Property="Foreground" Value="#5545AE"/><Setter Property="Background" Value="White"/><Setter Property="BorderBrush" Value="#DDD6F5"/><Setter Property="BorderThickness" Value="1"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="TextBox"><Border x:Name="Edge" CornerRadius="10" BorderThickness="{TemplateBinding BorderThickness}" BorderBrush="{TemplateBinding BorderBrush}" Background="{TemplateBinding Background}" Padding="{TemplateBinding Padding}"><ScrollViewer x:Name="PART_ContentHost"/></Border><ControlTemplate.Triggers><Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="Edge" Property="BorderBrush" Value="#6657E8"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
 </Window.Resources>
 <Border Margin="12" CornerRadius="22" Background="#F6F7FB"><Border.Effect><DropShadowEffect BlurRadius="18" ShadowDepth="3" Opacity="0.18" Color="#20372B"/></Border.Effect>
  <Grid ClipToBounds="False"><Grid.ColumnDefinitions><ColumnDefinition Width="292"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
   <Border Background="#DED7FA" CornerRadius="22,0,0,22">
    <Grid Margin="34,30"><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
     <StackPanel Orientation="Horizontal"><Viewbox Width="27" Height="27" Margin="0,0,9,0"><Canvas Width="64" Height="64"><Path Fill="#5545AE" Data="M 8,32 C 18,12 42,12 52,24 L 62,17 L 58,32 L 62,47 L 52,40 C 42,52 18,52 8,32 Z"/><Ellipse Fill="#DED7FA" Width="6" Height="6" Canvas.Left="21" Canvas.Top="25"/></Canvas></Viewbox><TextBlock Text="LAOYU STUDIO" FontWeight="SemiBold" Foreground="#5545AE" VerticalAlignment="Center" FontSize="11"/></StackPanel>
     <StackPanel Grid.Row="1" VerticalAlignment="Center" Margin="0,-8,0,0">
      <Image Source="__MASCOT__" Width="134" Height="134" HorizontalAlignment="Left" Margin="0,0,0,20"/>
      <TextBlock Foreground="#5545AE" FontSize="30" FontWeight="Bold" LineHeight="43" Text="把求职，&#10;理得更顺。"/>
      <TextBlock Text="岗位 · 简历 · Agent 协作" Foreground="#52664B" Margin="0,20,0,0" FontSize="13"/>
     </StackPanel>
     <StackPanel Grid.Row="2"><Image Source="__ICON__" Width="70" Height="70" HorizontalAlignment="Left" Margin="0,0,0,12"/><TextBlock Text="一键投递" FontWeight="SemiBold" Foreground="#5545AE"/><TextBlock x:Name="VersionLabel" Text="Windows 10 / 11" Margin="0,7,0,0" Foreground="#69704C" FontSize="11"/></StackPanel>
    </Grid>
   </Border>
   <Grid Grid.Column="1" Margin="36,28,36,30"><Grid.RowDefinitions><RowDefinition Height="30"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
    <Grid x:Name="DragArea" Background="Transparent"><TextBlock Text="YOUR CAREER WORKSPACE" FontSize="10" Foreground="#9AA397" VerticalAlignment="Center"/><StackPanel Orientation="Horizontal" HorizontalAlignment="Right"><Button x:Name="MinButton" AutomationProperties.Name="最小化" Content="—" Background="Transparent" Padding="10,5"/><Button x:Name="CloseButton" AutomationProperties.Name="关闭安装器" Background="Transparent" Padding="10,5"><Path Data="M 0,0 L 10,10 M 10,0 L 0,10" Stroke="#788578" StrokeThickness="1.4" Width="10" Height="10"/></Button></StackPanel></Grid>
    <StackPanel x:Name="SetupPanel" Grid.Row="1" Margin="0,29,0,0">
     <TextBlock Text="欢迎，给软件选个家。" Foreground="#5545AE" FontSize="25" FontWeight="SemiBold"/>
     <TextBlock Text="选好位置，就可以开始使用了。" Foreground="#899185" Margin="0,11,0,30"/>
     <Grid Margin="0,0,0,10"><TextBlock Text="安装位置" Foreground="#516452" FontWeight="SemiBold"/><Border HorizontalAlignment="Right" Background="#EAE5FB" Padding="9,3" CornerRadius="6"><TextBlock x:Name="DriveBadge" Text="优先非系统盘" Foreground="#6C795B" FontSize="10"/></Border></Grid>
     <TextBox x:Name="PathInput" MinHeight="45"/>
     <Grid Margin="0,9,0,0"><TextBlock Text="建议不要装到 C 盘，为系统盘留点空间。" Foreground="#919986" FontSize="11" VerticalAlignment="Center"/><Button x:Name="BrowseButton" Content="更换位置 ↗" Padding="9,7" Background="Transparent" HorizontalAlignment="Right" FontSize="11"/></Grid>
     <TextBlock x:Name="LocationHint" Foreground="#899185" FontSize="11" Margin="0,9,0,0" TextWrapping="Wrap" MaxHeight="34"/>
     <CheckBox x:Name="DesktopCheck" Content="在桌面放一个快捷方式" Margin="0,25,0,0"/>
     <TextBlock x:Name="ErrorLabel" Foreground="#B95F42" FontSize="11" TextWrapping="Wrap" Margin="0,10,0,0"/>
    </StackPanel>
    <StackPanel x:Name="ProgressPanel" Grid.Row="1" VerticalAlignment="Center" Visibility="Collapsed">
     <TextBlock Text="好工具，正在就位。" Foreground="#5545AE" FontSize="25" FontWeight="SemiBold"/>
     <TextBlock Text="稍等一下，很快就好。" Foreground="#899185" Margin="0,13,0,38"/>
     <Grid Margin="0,0,0,12"><TextBlock x:Name="StageLabel" Text="正在准备安装" Foreground="#627660"/><TextBlock x:Name="PercentLabel" Text="0%" Foreground="#5545AE" HorizontalAlignment="Right" FontWeight="SemiBold"/></Grid>
     <Grid x:Name="ProgressTrack" Height="8"><Border Background="#EAE5FB" CornerRadius="4"/><Border x:Name="ProgressFill" Background="#5545AE" CornerRadius="4" Width="0" HorizontalAlignment="Left"/></Grid>
     <TextBlock x:Name="InstallPathLabel" Foreground="#9BA292" FontSize="11" TextWrapping="Wrap" Margin="0,18,0,0"/>
    </StackPanel>
    <StackPanel x:Name="FinishPanel" Grid.Row="1" VerticalAlignment="Center" Visibility="Collapsed">
     <Border Width="54" Height="54" CornerRadius="18" Background="#EAE5FB" HorizontalAlignment="Left" Margin="0,0,0,24"><Path Data="M 14,27 L 23,35 L 40,18" Stroke="#5545AE" StrokeThickness="3" StrokeStartLineCap="Round" StrokeEndLineCap="Round"/></Border>
     <TextBlock Text="准备好了，开始发现。" Foreground="#5545AE" FontSize="25" FontWeight="SemiBold"/>
     <TextBlock Text="一键投递已经加入开始菜单，&#10;下次见，还是从这里出发。" Foreground="#899185" Margin="0,14,0,27" LineHeight="23"/>
     <CheckBox x:Name="LaunchCheck" Content="完成后打开一键投递" IsChecked="False"/>
     <TextBlock Text="想固定到任务栏？打开后右键图标即可。" Foreground="#9BA292" FontSize="11" Margin="0,18,0,0"/>
    </StackPanel>
    <Grid Grid.Row="2"><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="160"/></Grid.ColumnDefinitions><TextBlock x:Name="FooterLabel" Text="仅为当前用户安装&#10;个人设置和软件关联会保留" Foreground="#A1A795" FontSize="10" LineHeight="18" VerticalAlignment="Center"/><Button x:Name="PrimaryButton" Grid.Column="1" Content="开始安装  →" Background="#5545AE" Foreground="#FFFFFF" FontSize="14" FontWeight="SemiBold" MinHeight="46"/></Grid>
   </Grid>
  </Grid>
 </Border>
</Window>
'@
$xaml=$xaml.Replace('__ICON__',(Join-Path $PSScriptRoot 'icon.png')).Replace('__MASCOT__',(Join-Path $PSScriptRoot 'mascot.png'))
$window = [Windows.Markup.XamlReader]::Parse($xaml)
$controls = @{}
foreach($name in @('DragArea','MinButton','CloseButton','VersionLabel','PathInput','DriveBadge','BrowseButton','LocationHint','DesktopCheck','ErrorLabel','SetupPanel','ProgressPanel','FinishPanel','StageLabel','PercentLabel','ProgressTrack','ProgressFill','InstallPathLabel','LaunchCheck','PrimaryButton','FooterLabel')) { $controls[$name] = $window.FindName($name) }
$controls.VersionLabel.Text = "v$Version  ·  Windows 10 / 11"
$controls.PathInput.Text = $InstallDir
$controls.LocationHint.Text = $LocationReason
$controls.DesktopCheck.IsChecked = ($DesktopDefault -eq 1)
if($LocationReason -match '已有|指定'){$controls.DriveBadge.Text = '保留你的选择'}
$window.Add_MouseLeftButtonDown({param($sender,$e) if($e.OriginalSource -is [Windows.Controls.TextBlock] -or $e.OriginalSource -is [Windows.Shapes.Path]){try{$window.DragMove()}catch{}}})
$controls.MinButton.Add_Click({$window.WindowState='Minimized'})
$controls.CloseButton.Add_Click({if(-not $script:installing){$window.Close()}})
$window.Add_Closing({param($sender,$e) if($script:installing){$e.Cancel=$true}})

function Show-FolderPicker {
 $pickerXaml=@'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Width="560" Height="470" WindowStyle="None" ResizeMode="NoResize" AllowsTransparency="True" Background="Transparent" WindowStartupLocation="CenterOwner" FontFamily="Microsoft YaHei UI" FontSize="13">
 <Border Margin="10" Padding="26" CornerRadius="18" Background="#F6F7FB" BorderThickness="1" BorderBrush="#DFE4D6"><Grid><Grid.RowDefinitions><RowDefinition Height="40"/><RowDefinition Height="44"/><RowDefinition Height="38"/><RowDefinition Height="*"/><RowDefinition Height="54"/></Grid.RowDefinitions><TextBlock Text="给软件选个家" Foreground="#5545AE" FontSize="20" FontWeight="SemiBold"/><StackPanel Name="Drives" Grid.Row="1" Orientation="Horizontal"/><Grid Grid.Row="2"><Grid.ColumnDefinitions><ColumnDefinition Width="76"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions><Button Name="Up" Content="↑ 上一级" Padding="7,5"/><TextBlock Name="Current" Grid.Column="1" Margin="12,0,0,0" VerticalAlignment="Center" Foreground="#7F8D78" TextTrimming="CharacterEllipsis"/></Grid><ListBox Name="Folders" Grid.Row="3" BorderThickness="0" Background="Transparent" Margin="0,12,0,0" Foreground="#5545AE" ScrollViewer.HorizontalScrollBarVisibility="Disabled"><ListBox.ItemContainerStyle><Style TargetType="ListBoxItem"><Setter Property="Padding" Value="12,9"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="ListBoxItem"><Border Name="Item" CornerRadius="7" Padding="{TemplateBinding Padding}"><ContentPresenter/></Border><ControlTemplate.Triggers><Trigger Property="IsSelected" Value="True"><Setter TargetName="Item" Property="Background" Value="#EAE5FB"/></Trigger><Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Item" Property="Background" Value="#F0ECFC"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style></ListBox.ItemContainerStyle></ListBox><StackPanel Grid.Row="4" Orientation="Horizontal" HorizontalAlignment="Right" VerticalAlignment="Bottom"><Button Name="Cancel" Content="取消" Padding="18,9" Margin="0,0,8,0"/><Button Name="Select" Content="使用此文件夹" Background="#5545AE" Foreground="White" Padding="18,9"/></StackPanel></Grid></Border>
</Window>
'@
 $script:picker=[Windows.Markup.XamlReader]::Parse($pickerXaml)
 $script:picker.Owner=$window
 $script:picker.Resources=$window.Resources
 $script:pickerPath=$controls.PathInput.Text
 while($script:pickerPath -and -not [IO.Directory]::Exists($script:pickerPath)){$parent=[IO.Directory]::GetParent($script:pickerPath);if($parent){$script:pickerPath=$parent.FullName}else{break}}
 if(-not [IO.Directory]::Exists($script:pickerPath)){$script:pickerPath=[IO.Path]::GetPathRoot($env:WINDIR)}
 $script:pickerItems=@()
 function Refresh-Folders {
  $script:picker.FindName('Current').Text=$script:pickerPath
  $list=$script:picker.FindName('Folders');$list.Items.Clear();$script:pickerItems=@()
  try { $script:pickerItems=@(Get-ChildItem -LiteralPath $script:pickerPath -Directory -ErrorAction Stop | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::Hidden) } | Sort-Object Name);foreach($folder in $script:pickerItems){[void]$list.Items.Add($folder.Name+'  ›')} } catch { [void]$list.Items.Add('这个文件夹暂时无法访问，请选择其他位置。') }
 }
 foreach($drive in [IO.DriveInfo]::GetDrives() | Where-Object {$_.IsReady -and $_.DriveType -eq 'Fixed'}){
  $button=New-Object Windows.Controls.Button;$button.Content=$drive.Name.TrimEnd('\');$button.Tag=$drive.Name;$button.Margin='0,0,8,0';$button.Padding='12,6';$button.Add_Click({param($s,$e) $script:pickerPath=[string]$s.Tag;Refresh-Folders});[void]$script:picker.FindName('Drives').Children.Add($button)
 }
 $script:picker.FindName('Folders').Add_MouseDoubleClick({$index=$script:picker.FindName('Folders').SelectedIndex;if($index -ge 0 -and $index -lt $script:pickerItems.Count){$script:pickerPath=$script:pickerItems[$index].FullName;Refresh-Folders}})
 $script:picker.FindName('Up').Add_Click({$parent=[IO.Directory]::GetParent($script:pickerPath);if($parent){$script:pickerPath=$parent.FullName;Refresh-Folders}})
 $script:picker.FindName('Cancel').Add_Click({$script:picker.Close()})
 $script:picker.FindName('Select').Add_Click({$controls.PathInput.Text=Join-Path $script:pickerPath 'Laoyu\YijianToudi';$controls.LocationHint.Text='使用你指定的安装位置。';$controls.DriveBadge.Text='你的选择';$script:picker.Close()})
 Refresh-Folders
 if($PreviewFolder -and $CapturePath){$script:picker.Add_ContentRendered({$script:picker.UpdateLayout();$b=[Windows.Media.Imaging.RenderTargetBitmap]::new([int]$script:picker.ActualWidth,[int]$script:picker.ActualHeight,96,96,[Windows.Media.PixelFormats]::Pbgra32);$b.Render($script:picker);$e=[Windows.Media.Imaging.PngBitmapEncoder]::new();$e.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($b));$f=[IO.File]::Create($CapturePath);try{$e.Save($f)}finally{$f.Dispose()}})}
 [void]$script:picker.ShowDialog()
}
$controls.BrowseButton.Add_Click({Show-FolderPicker})

function Set-Progress([int]$percent,[string]$stage) {
 $controls.PercentLabel.Text="$percent%";$controls.StageLabel.Text=$stage
 $controls.ProgressFill.Width=[Math]::Max(0,([double]$controls.ProgressTrack.ActualWidth*[double]$percent/100.0))
}
function Capture-UI([string]$destination) {
 if(-not $destination){return};$window.UpdateLayout()
 if($controls.ProgressPanel.Visibility -eq 'Visible'){Set-Progress ([int]$controls.PercentLabel.Text.TrimEnd('%')) $controls.StageLabel.Text;$window.UpdateLayout()}
 $bitmap=New-Object Windows.Media.Imaging.RenderTargetBitmap ([int]$window.ActualWidth),([int]$window.ActualHeight),96,96,([Windows.Media.PixelFormats]::Pbgra32)
 $bitmap.Render($window);$encoder=New-Object Windows.Media.Imaging.PngBitmapEncoder;$encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
 $stream=[IO.File]::Open($destination,[IO.FileMode]::Create);try{$encoder.Save($stream)}finally{$stream.Dispose()}
}
function Test-InstallPath([string]$location) {
 if($location -notmatch '^[A-Za-z]:\\' -or $location.Length -le 3 -or $location.Contains('"')){throw '请选择磁盘下的文件夹，例如 D:\Applications\Laoyu\YijianToudi。'}
 $location=[IO.Path]::GetFullPath($location).TrimEnd('\')
 foreach($protected in @($env:WINDIR,$env:USERPROFILE,$env:ProgramFiles,${env:ProgramFiles(x86)})){
  if($protected -and $location -eq $protected.TrimEnd('\')){throw '请选择独立的软件子目录，不要使用系统或用户目录本身。'}
 }
 $cursor=$location
 while($cursor -and [IO.Path]::GetPathRoot($cursor).TrimEnd('\') -ne $cursor){
  if([IO.Directory]::Exists($cursor) -and ((Get-Item -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw '请选择非链接的实际安装目录。'}
  $parent=[IO.Directory]::GetParent($cursor);if($parent){$cursor=$parent.FullName}else{break}
 }

 $drive=New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($location))
 if(-not $drive.IsReady -or $drive.AvailableFreeSpace -lt 2147483648){throw '这个磁盘空间不足，请至少预留 2 GB。'}
 
 [void][IO.Directory]::CreateDirectory($location)
 $probe=Join-Path $location ('.laoyu-install-probe-'+[Guid]::NewGuid().ToString('N')+'.tmp')
 $stream=[IO.File]::Open($probe,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$stream.Dispose()}finally{[IO.File]::Delete($probe)}
 return $location
}
function Start-Installation {
 try {
  $controls.ErrorLabel.Text=''
  $script:selectedPath=Test-InstallPath ($controls.PathInput.Text.Trim())
  if(-not [IO.File]::Exists($InstallerPath)){throw '安装文件已移动，请重新下载并打开安装包。'}
  $arguments='/S /DESKTOP='+$(if($controls.DesktopCheck.IsChecked){'1 '}else{'0 '})+'/D='+$script:selectedPath
  $start=New-Object Diagnostics.ProcessStartInfo;$start.FileName=$InstallerPath;$start.Arguments=$arguments;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
  $script:process=[Diagnostics.Process]::Start($start)
  $script:installing=$true;$script:startedAt=Get-Date
  $controls.SetupPanel.Visibility='Collapsed';$controls.ProgressPanel.Visibility='Visible';$controls.PrimaryButton.IsEnabled=$false;$controls.PrimaryButton.Content='正在安装';$controls.CloseButton.IsEnabled=$false
  $controls.InstallPathLabel.Text=$script:selectedPath;Set-Progress 5 '正在准备安装'
  $script:timer=New-Object Windows.Threading.DispatcherTimer;$script:timer.Interval=[TimeSpan]::FromMilliseconds(400)
  $script:timer.Add_Tick({
   try {
    if(-not $script:process.HasExited){
     $bytes=0L;$target=$script:selectedPath
     if([IO.Directory]::Exists($target)){foreach($file in [IO.Directory]::EnumerateFiles($target,'*',[IO.SearchOption]::AllDirectories)){try{$bytes+=(New-Object IO.FileInfo $file).Length}catch{}}}
     $percent=[Math]::Min(96,[Math]::Max(5,[int](90*$bytes/[Math]::Max(1,$PayloadBytes))))
     Set-Progress $percent $(if($percent -ge 90){'正在创建快捷方式'}else{'正在释放软件文件'});return
    }
    $script:timer.Stop();$script:installing=$false;$controls.CloseButton.IsEnabled=$true
    if($script:process.ExitCode -ne 0){throw "安装没有完成（代码 $($script:process.ExitCode)）。请先退出一键投递，再重试。"}
    $executable=Join-Path $script:selectedPath "一键投递.exe"
    $record=Find-RegisteredInstall @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')
    if(-not [IO.File]::Exists($executable) -or $record.Version -ne $Version -or $record.Root -ne $script:selectedPath -or ([Diagnostics.FileVersionInfo]::GetVersionInfo($executable).FileVersion -ne $Version)){throw '安装结果未能确认，请重试或选择其他位置。'}
    $script:installed=$true;Set-Progress 100 '安装完成'
    $controls.ProgressPanel.Visibility='Collapsed';$controls.FinishPanel.Visibility='Visible';$controls.PrimaryButton.Content='完成  →';$controls.PrimaryButton.IsEnabled=$true;$controls.FooterLabel.Text='安装完成 · 随时出发'
    if($Acceptance){Capture-UI $CapturePath;@{status='passed';version=$Version;path=$script:selectedPath;registered=$true;executable=$executable;desktop=[bool]$controls.DesktopCheck.IsChecked;elapsed=((Get-Date)-$script:startedAt).TotalSeconds}|ConvertTo-Json|Set-Content -LiteralPath $ReportPath -Encoding UTF8;$window.Close()}
   } catch {
    if($script:timer){$script:timer.Stop()};$script:installing=$false;$script:exitCode=1;$controls.CloseButton.IsEnabled=$true;$controls.ProgressPanel.Visibility='Collapsed';$controls.SetupPanel.Visibility='Visible';$controls.PrimaryButton.Content='重新安装  →';$controls.PrimaryButton.IsEnabled=$true;$controls.ErrorLabel.Text=$_.Exception.Message
    if($Acceptance){@{status='failed';message=$_.Exception.Message}|ConvertTo-Json|Set-Content -LiteralPath $ReportPath -Encoding UTF8;$window.Close()}
   }
  });$script:timer.Start()
 }catch{$controls.ErrorLabel.Text=$_.Exception.Message;if($Acceptance){$script:exitCode=1;@{status='failed';message=$_.Exception.Message}|ConvertTo-Json|Set-Content -LiteralPath $ReportPath -Encoding UTF8;$window.Close()}}
}
$controls.PrimaryButton.Add_Click({
 if($Preview){return}
 if($script:installed){
  if($controls.LaunchCheck.IsChecked){$launch=New-Object Diagnostics.ProcessStartInfo;$launch.FileName=Join-Path $script:selectedPath "一键投递.exe";$launch.UseShellExecute=$true;[void][Diagnostics.Process]::Start($launch)}
  $window.Close()
 }else{Start-Installation}
})
$window.Add_ContentRendered({
 if($Preview){
  if($PreviewScreen -eq 'progress'){$controls.SetupPanel.Visibility='Collapsed';$controls.ProgressPanel.Visibility='Visible';$controls.PrimaryButton.Content='正在安装';$controls.PrimaryButton.IsEnabled=$false;$controls.InstallPathLabel.Text=$InstallDir;Set-Progress 63 '正在释放软件文件'}
  if($PreviewScreen -eq 'finish'){$controls.SetupPanel.Visibility='Collapsed';$controls.FinishPanel.Visibility='Visible';$controls.PrimaryButton.Content='完成  →';$controls.FooterLabel.Text='安装完成 · 随时出发'}
  if(-not $PreviewFolder){$window.Left=-10000;$captureTimer=New-Object Windows.Threading.DispatcherTimer;$captureTimer.Interval=[TimeSpan]::FromMilliseconds(300);$captureTimer.Add_Tick({param($s,$e) $s.Stop();Capture-UI $CapturePath;$window.Close()});$captureTimer.Start()}
 }
 if($Acceptance){Start-Installation}
 if($PreviewFolder){Show-FolderPicker}
})
try{[void]$window.ShowDialog()}finally{if($script:timer){$script:timer.Stop()};if($script:process){$script:process.Dispose()}}
exit $script:exitCode
