import figuro

let
  typeface = defaultTypeface()
  font = UiFont(typefaceId: typeface, size: 32)

type Main* = ref object of Figuro

proc draw*(self: Main) {.slot.} =
  withRootWidget(self):
    this.setName "main"
    Rectangle.new "body":
      with this:
        box 0'ux, 0'ux, 600'ux, 200'ux
        fill css"#FF0000"
      Text.new "text":
        size 100'pp, 100'pp
        foreground css"#FFFFFF"
        justify Center
        align Middle
        text({font: "HELLO WORLD"})
      WidgetContents()

var main = Main.new()
var frame = newAppFrame(main, size=(600'ui, 200'ui))
startFiguro(frame)
