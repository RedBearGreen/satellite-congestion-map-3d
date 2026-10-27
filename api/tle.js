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
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT
            },
            // 元のaxios版と同じJSON形式でログイン
            body: JSON.stringify({ identity: username, password }),
            redirect: 'manual'
        });
        if (loginRes.status !== 200) {
            throw new Error(`Login failed with status: ${loginRes.status}`);
        }
        const loginBody = await loginRes.text();
        if (/fail/i.test(loginBody)) {
            throw new Error('Login failed: check Space-Track credentials');
        }

        // 2. ログインで受け取ったセッションCookieを取り出す
        const cookie = loginRes.headers.getSetCookie()
            .map(c => c.split(';')[0])
            .join('; ');
        if (!cookie) {
            throw new Error('No session cookie returned from Space-Track');
        }

        // 3. TLEを取得(推奨のgpクラスを先に試し、ダメなら旧tle_latestクラスで再挑戦)
        const base = 'https://www.space-track.org/basicspacedata/query/class';
        const urls = [
            `${base}/gp/NORAD_CAT_ID/${noradId}/orderby/EPOCH%20desc/limit/1/format/json`,
            `${base}/tle_latest/NORAD_CAT_ID/${noradId}/orderby/EPOCH%20desc/limit/1/format/json`
        ];
        let data = null;
        const failures = [];
        for (const url of urls) {
            const tleRes = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': USER_AGENT,
                    'Cookie': cookie
                }
            });
            if (tleRes.ok) {
                data = await tleRes.json();
                break;
            }
            const snippet = (await tleRes.text()).slice(0, 120).replace(/\s+/g, ' ');
            failures.push(`${url.includes('/gp/') ? 'gp' : 'tle_latest'} ${tleRes.status} ${snippet}`);
        }
        if (!data) {
            throw new Error(`TLE request failed: ${failures.join(' | ')}`);
        }
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
