sub init()
    m.top.observeField("apiBase", "onApiBase")

    m.loginView = m.top.findNode("loginView")
    m.homeView = m.top.findNode("homeView")
    m.contentView = m.top.findNode("contentView")
    m.blockedView = m.top.findNode("blockedView")

    m.loginButton = m.top.findNode("loginButton")
    m.serverInput = m.top.findNode("serverInput")
    m.userInput = m.top.findNode("userInput")
    m.passInput = m.top.findNode("passInput")
    m.loginError = m.top.findNode("loginError")

    m.categories = m.top.findNode("categories")
    m.grid = m.top.findNode("contentGrid")
    m.video = m.top.findNode("video")
    m.miniPlayer = m.top.findNode("miniPlayer")
    m.miniTitle = m.top.findNode("miniTitle")
    m.miniInfo = m.top.findNode("miniInfo")
    m.deviceBadge = m.top.findNode("deviceBadge")
    m.userBadge = m.top.findNode("userBadge")

    m.di = CreateObject("roDeviceInfo")
    rawId = UCase(m.di.GetChannelClientId())
    rawId = rawId.Replace("-", "").Replace(" ", "")
    if Len(rawId) > 12 then rawId = Left(rawId, 12)
    while Len(rawId) < 12
        rawId = rawId + "0"
    end while
    m.deviceId = "ROKU-" + rawId
    m.deviceBadge.text = m.deviceId

    m.apiBase = "https://wrb-tv-business.netlify.app/api"
    m.server = ""
    m.user = ""
    m.pass = ""
    m.currentType = "live"
    m.currentCategory = "*"
    m.activeServer = ""
    m.authorized = false
    m.loginCandidates = []
    m.loginIndex = 0

    m.refreshTimer = CreateObject("roSGNode", "Timer")
    m.refreshTimer.duration = 60
    m.refreshTimer.repeat = true
    m.refreshTimer.observeField("fire", "heartbeat")
    m.refreshTimer.control = "start"

    m.loginButton.observeField("buttonSelected", "onLogin")
    m.top.findNode("navHome").observeField("buttonSelected", "showHome")
    m.top.findNode("navLive").observeField("buttonSelected", "showLive")
    m.top.findNode("navMovies").observeField("buttonSelected", "showMovies")
    m.top.findNode("navSeries").observeField("buttonSelected", "showSeries")
    m.top.findNode("homeLive").observeField("buttonSelected", "showLive")
    m.top.findNode("homeMovies").observeField("buttonSelected", "showMovies")
    m.top.findNode("homeSeries").observeField("buttonSelected", "showSeries")
    m.top.findNode("homeExit").observeField("buttonSelected", "logout")
    m.top.findNode("miniFull").observeField("buttonSelected", "openFullPlayer")
    m.categories.observeField("itemSelected", "categorySelected")
    m.grid.observeField("itemSelected", "gridSelected")

    m.serverInput.setFocus(true)
    checkDevice()
end sub

sub onApiBase()
    if m.top.apiBase <> invalid and Len(m.top.apiBase) > 0 then
        m.apiBase = m.top.apiBase
    end if
end sub

sub request(kind as String, url as String, method as String, body as String)
    task = CreateObject("roSGNode", "HttpTask")
    task.url = url
    task.method = method
    task.body = body
    task.observeField("done", "requestFinished")
    m.pendingTask = task
    m.pendingKind = kind
    task.control = "run"
end sub

sub requestFinished(evt as Object)
    if not evt.getData() then return

    task = evt.getNode()
    kind = m.pendingKind
    response = task.response
    status = task.status

    if task.error <> invalid and Len(task.error) > 0 and status < 0
        handleError(kind, task.error)
        return
    end if

    data = invalid
    if Len(response) > 0 then data = ParseJson(response)

    if kind = "device"
        if data = invalid then
            showBlocked("Não foi possível consultar a autorização do dispositivo.")
            return
        end if

        if data.authorized = true
            m.authorized = true
            m.blockedView.visible = false
            m.loginView.visible = true
            m.loginButton.setFocus(true)
        else
            m.authorized = false
            m.loginView.visible = false
            m.homeView.visible = false
            m.contentView.visible = false
            m.top.findNode("blockedId").text = "ID: " + m.deviceId
            m.blockedView.visible = true
        end if

    else if kind = "heartbeat"
        if data <> invalid and data.authorized <> true
            showBlocked("Este dispositivo foi desativado pelo painel.")
        end if

    else if kind = "login"
        handleLoginResponse(data)

    else if kind = "categories"
        loadCategories(data)

    else if kind = "content"
        loadContent(data)

    else if kind = "seriesInfo"
        playFirstEpisode(data)
    end if
end sub

sub handleLoginResponse(data as Object)
    if data = invalid or data.user_info = invalid or data.user_info.auth <> 1
        if m.loginIndex < m.loginCandidates.Count()
            tryLoginCandidate()
        else
            msg = "Usuário ou senha inválidos."
            if data <> invalid and data.user_info <> invalid and data.user_info.message <> invalid
                msg = data.user_info.message
            end if
            m.loginError.text = msg
            m.loginButton.setFocus(true)
        end if
        return
    end if

    m.loginError.text = ""
    m.userBadge.text = m.user
    showHome()
    heartbeat()
end sub

sub handleError(kind as String, msg as String)
    if kind = "device" or kind = "heartbeat"
        showBlocked(msg)
    else if kind = "login"
        if m.loginIndex < m.loginCandidates.Count()
            tryLoginCandidate()
        else
            m.loginError.text = msg
        end if
    else
        m.loginError.text = msg
    end if
end sub

sub showBlocked(msg as String)
    m.authorized = false
    m.loginView.visible = false
    m.homeView.visible = false
    m.contentView.visible = false
    m.video.control = "stop"
    m.top.findNode("blockedText").text = msg
    m.top.findNode("blockedId").text = "ID: " + m.deviceId
    m.blockedView.visible = true
end sub

sub checkDevice()
    body = {
        device_id: m.deviceId,
        app_id: "WRB-PLAY-ROKU",
        platform: "Roku TV",
        version: "1.0.0"
    }
    request("device", m.apiBase + "/v1/device/check", "POST", FormatJson(body))
end sub

sub heartbeat()
    if not m.authorized then return

    body = {
        device_id: m.deviceId,
        app_id: "WRB-PLAY-ROKU",
        platform: "Roku TV",
        version: "1.0.0",
        user: m.user
    }
    request("heartbeat", m.apiBase + "/v1/device/heartbeat", "POST", FormatJson(body))
end sub

function candidatesFor(server as String) as Object
    s = server.Trim()
    key = UCase(s)
    if key = "0022" then return ["http://rekgol.top", "http://aptxu.com"]
    if key = "PFAST" then return ["http://wrb-tv.top", "http://p1fast.com"]
    if not s.StartsWith("http://") and not s.StartsWith("https://") then
        s = "http://" + s
    end if
    return [s]
end function

sub onLogin()
    if not m.authorized then
        showBlocked("Entre em contato com seu revendedor para ativar este dispositivo.")
        return
    end if

    m.server = m.serverInput.text.Trim()
    m.user = m.userInput.text.Trim()
    m.pass = m.passInput.text

    if Len(m.server) = 0 or Len(m.user) = 0 or Len(m.pass) = 0
        m.loginError.text = "Preencha servidor, usuário e senha."
        return
    end if

    m.loginError.text = "Conectando..."
    m.loginCandidates = candidatesFor(m.server)
    m.loginIndex = 0
    tryLoginCandidate()
end sub

sub tryLoginCandidate()
    if m.loginIndex >= m.loginCandidates.Count() then
        m.loginError.text = "Não foi possível conectar ao servidor."
        return
    end if

    candidate = m.loginCandidates[m.loginIndex]
    m.activeServer = candidate

    url = candidate + "/player_api.php?username=" + m.user.EncodeUriComponent() + "&password=" + m.pass.EncodeUriComponent()
    m.loginIndex = m.loginIndex + 1
    request("login", url, "GET", "")
end sub

sub showHome()
    m.loginView.visible = false
    m.contentView.visible = false
    m.blockedView.visible = false
    m.homeView.visible = true
    m.top.findNode("navHome").setFocus(true)
end sub

sub loadCategoriesFor(t as String)
    m.currentType = t

    action = "get_live_categories"
    if t = "movies" then action = "get_vod_categories"
    if t = "series" then action = "get_series_categories"

    url = m.activeServer + "/player_api.php?username=" + m.user.EncodeUriComponent() + "&password=" + m.pass.EncodeUriComponent() + "&action=" + action
    request("categories", url, "GET", "")
end sub

sub showLive()
    if Len(m.activeServer) = 0 then return
    m.currentType = "live"
    m.homeView.visible = false
    m.loginView.visible = false
    m.contentView.visible = true
    m.miniPlayer.visible = true
    loadCategoriesFor("live")
    m.top.findNode("navLive").setFocus(true)
end sub

sub showMovies()
    if Len(m.activeServer) = 0 then return
    m.currentType = "movies"
    m.homeView.visible = false
    m.loginView.visible = false
    m.contentView.visible = true
    m.miniPlayer.visible = false
    loadCategoriesFor("movies")
    m.top.findNode("navMovies").setFocus(true)
end sub

sub showSeries()
    if Len(m.activeServer) = 0 then return
    m.currentType = "series"
    m.homeView.visible = false
    m.loginView.visible = false
    m.contentView.visible = true
    m.miniPlayer.visible = false
    loadCategoriesFor("series")
    m.top.findNode("navSeries").setFocus(true)
end sub

sub loadCategories(data as Object)
    if data = invalid or Type(data) <> "roArray" then return

    root = CreateObject("roSGNode", "ContentNode")
    root.AppendChild(makeCategory("Todos", "*"))

    for each c in data
        if c <> invalid and c.category_name <> invalid and c.category_id <> invalid
            root.AppendChild(makeCategory(c.category_name, c.category_id.ToStr()))
        end if
    end for

    m.categories.content = root
    m.currentCategory = "*"
    m.categories.setFocus(true)
    loadContentForCurrent()
end sub

function makeCategory(title as String, id as String) as Object
    n = CreateObject("roSGNode", "ContentNode")
    n.title = title
    n.categoryId = id
    return n
end function

sub categorySelected()
    idx = m.categories.itemSelected
    item = m.categories.content.GetChild(idx)
    if item = invalid then return
    m.currentCategory = item.categoryId
    loadContentForCurrent()
end sub

sub loadContentForCurrent()
    action = "get_live_streams"
    if m.currentType = "movies" then action = "get_vod_streams"
    if m.currentType = "series" then action = "get_series"

    url = m.activeServer + "/player_api.php?username=" + m.user.EncodeUriComponent() + "&password=" + m.pass.EncodeUriComponent() + "&action=" + action
    if m.currentCategory <> "*" then
        url = url + "&category_id=" + m.currentCategory.EncodeUriComponent()
    end if

    request("content", url, "GET", "")
end sub

sub loadContent(data as Object)
    if data = invalid or Type(data) <> "roArray" then return

    root = CreateObject("roSGNode", "ContentNode")
    itemCount = 0

    for each item in data
        if item = invalid then continue

        n = CreateObject("roSGNode", "ContentNode")

        if m.currentType = "live"
            if item.stream_id = invalid then continue
            n.title = item.name
            n.hdPosterUrl = item.stream_icon
            n.url = m.activeServer + "/live/" + m.user.EncodeUriComponent() + "/" + m.pass.EncodeUriComponent() + "/" + item.stream_id.ToStr() + ".m3u8"
            n.streamFormat = "hls"
        else if m.currentType = "movies"
            if item.stream_id = invalid then continue
            n.title = item.name
            n.hdPosterUrl = item.stream_icon
            ext = item.container_extension
            if ext = invalid or Len(ext) = 0 then ext = "mp4"
            n.url = m.activeServer + "/movie/" + m.user.EncodeUriComponent() + "/" + m.pass.EncodeUriComponent() + "/" + item.stream_id.ToStr() + "." + ext
            n.streamFormat = "mp4"
        else
            if item.series_id = invalid then continue
            n.title = item.name
            n.hdPosterUrl = item.cover
            n.seriesId = item.series_id
        end if

        root.AppendChild(n)
        itemCount = itemCount + 1
    end for

    m.grid.content = root
    m.top.findNode("sectionTitle").text = m.currentType = "live" ? "Canais" : m.currentType = "movies" ? "Filmes" : "Séries"
    m.top.findNode("sectionCount").text = itemCount.ToStr() + " itens"
    m.grid.setFocus(true)
end sub

sub gridSelected()
    idx = m.grid.itemSelected
    item = m.grid.content.GetChild(idx)
    if item = invalid then return

    if m.currentType = "series"
        url = m.activeServer + "/player_api.php?username=" + m.user.EncodeUriComponent() + "&password=" + m.pass.EncodeUriComponent() + "&action=get_series_info&series_id=" + item.seriesId.ToStr()
        request("seriesInfo", url, "GET", "")
        return
    end if

    playContent(item)
end sub

sub playFirstEpisode(data as Object)
    if data = invalid or data.episodes = invalid then return
    for each seasonKey in data.episodes
        list = data.episodes[seasonKey]
        if Type(list) = "roArray" and list.Count() > 0
            ep = list[0]
            vc = CreateObject("roSGNode", "ContentNode")
            vc.url = ep.link
            if vc.url = invalid or Len(vc.url) = 0
                vc.url = ep.url
            end if
            vc.title = ep.title
            vc.streamFormat = "mp4"
            m.video.content = vc
            m.video.control = "play"
            m.video.setFocus(true)
            return
        end if
    end for
end sub

sub playContent(item as Object)
    if item = invalid then return

    vc = CreateObject("roSGNode", "ContentNode")
    vc.url = item.url
    vc.title = item.title
    vc.streamFormat = item.streamFormat

    m.video.content = vc
    m.video.control = "play"
    m.miniTitle.text = item.title
    m.miniInfo.text = "WRB-TV • " + m.currentType
    m.miniPlayer.visible = true
    m.video.setFocus(true)
end sub

sub openFullPlayer()
    if m.video.content = invalid then return
    m.contentView.visible = false
    m.video.width = 1280
    m.video.height = 720
    m.video.translation = "[0,0]"
    m.video.setFocus(true)
end sub

sub logout()
    m.video.control = "stop"
    m.activeServer = ""
    m.user = ""
    m.pass = ""
    m.userBadge.text = ""
    m.homeView.visible = false
    m.contentView.visible = false
    m.loginView.visible = true
    m.loginError.text = ""
    m.serverInput.text = ""
    m.userInput.text = ""
    m.passInput.text = ""
    m.serverInput.setFocus(true)
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false

    if key = "back"
        if m.video <> invalid and m.contentView.visible and m.video.control <> "stop"
            m.video.control = "stop"
            m.miniPlayer.visible = true
            m.grid.setFocus(true)
            return true
        end if

        if m.contentView.visible
            showHome()
            return true
        end if

        if m.homeView.visible
            return true
        end if
    end if

    return false
end function
