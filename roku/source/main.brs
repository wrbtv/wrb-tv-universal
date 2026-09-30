sub Main()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)

    scene = screen.CreateScene("MainScene")
    scene.apiBase = "https://wrb-tv-business.netlify.app/api"
    scene.SetFocus(true)
    screen.Show()
    scene.SetFocus(true)

    while true
        msg = Wait(0, port)
        if Type(msg) = "roSGScreenEvent"
            if msg.IsScreenClosed() then return
        end if
    end while
end sub
