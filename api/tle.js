// Space-Track から最新TLEを取得する Vercel Serverless Function
// 外部ライブラリなし(Node.js 18+ 標準の fetch を使用)
const USER_AGENT = 'satellite-congestion-map-3d/1.0';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Cesiumトークンを返す
    if (req.url === '/api/cesium-token') {
        const token = process.env.CESIUM_ACCESS_TOKEN || '';
        if (token) return res.status(200).send(token);
        return res.status(500).json({ error: 'Cesium access token not set or invalid' });
    }

    // NORAD IDは数字のみ許可(URLへの不正な文字の埋め込みを防ぐ)
    const noradId = String(req.query.norad || '25544').trim();
    if (!/^\d{1,9}$/.test(noradId)) {
        return res.status(400).json({ error: 'NORAD CAT ID must be digits only' });
    }

    const username = process.env.SPACE_TRACK_USERNAME || '';
    const password = process.env.SPACE_TRACK_PASSWORD || '';
    if (!username || !password) {
        return res.status(500).json({ error: 'Space-Track credentials are not set' });
    }

    try {
        // 1. Space-Trackにログイン
        const loginRes = await fetch('https://www.space-track.org/ajaxauth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': USER_AGENT
            },
            body: new URLSearchParams({ identity: username, password }),
            redirect: 'manual'
        });
        if (loginRes.status !== 200) {
            throw new Error(`Login failed with status: ${loginRes.status}`);
        }
        const loginBody = await loginRes.text();
        if (loginBody.includes('"Login":"Failed"')) {
            throw new Error('Login failed: check Space-Track credentials');
        }

        // 2. ログインで受け取ったセッションCookieを取り出す
        const cookie = loginRes.headers.getSetCookie()
            .map(c => c.split(';')[0])
            .join('; ');
        if (!cookie) {
            throw new Error('No session cookie returned from Space-Track');
        }

        // 3. TLEを取得
        const tleUrl = `https://www.space-track.org/basicspacedata/query/class/tle_latest/NORAD_CAT_ID/${noradId}/orderby/EPOCH%20desc/limit/1/format/json`;
        const tleRes = await fetch(tleUrl, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': USER_AGENT,
                'Cookie': cookie
            }
        });
        if (!tleRes.ok) {
            throw new Error(`TLE request failed with status: ${tleRes.status}`);
        }
        const data = await tleRes.json();
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('No TLE data received from Space-Track');
        }

        const tleData = data[0];
        const tleLines = [tleData.TLE_LINE1, tleData.TLE_LINE2].filter(line => line && line.trim());
        if (tleLines.length < 2) {
            throw new Error('Invalid TLE data: Less than 2 lines received');
        }

        res.status(200).json({
            name: tleData.OBJECT_NAME || `Satellite ${noradId}`,
            tle1: tleLines[0],
            tle2: tleLines[1]
        });
    } catch (error) {
        console.error('Error fetching TLE:', error.message);
        res.status(500).json({ error: 'Failed to fetch TLE data: ' + error.message });
    }
};
