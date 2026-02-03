//const API_BASE = "http://15.164.93.1:5000";
const API_BASE = "https://blind-yield-payroll-attacks.trycloudflare.com"

document.addEventListener("DOMContentLoaded", () => {
    // ------------------------------------------------------------------------
    // Map 초기화
    // ------------------------------------------------------------------------
    const map = L.map("map").setView([37.4660, 126.8898], 13); // 금천01 근처(독산역) 기준

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19
    }).addTo(map);

    // ------------------------------------------------------------------------
    // 아이콘 설정
    // ------------------------------------------------------------------------

    // 파란 버스 아이콘 (기본)
    const busIconBlue = new L.Icon({
        iconUrl: "https://img.icons8.com/fluency/48/bus2.png",
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -13]
    });

    // 빨간 버스 아이콘
    const busIconRed = new L.Icon({
        iconUrl: "https://img.icons8.com/fluency/48/double-decker-bus.png",
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -13]
    });

    // 버스 정류장 아이콘
    const stopIcon = new L.Icon({
        iconUrl: "https://img.icons8.com/emoji/48/bus-stop-emoji.png",
        iconSize: [26, 26],
        iconAnchor: [13, 26],
        popupAnchor: [0, -26]
    });

    // ------------------------------------------------------------------------
    // 레이어/마커 상태
    // ------------------------------------------------------------------------
    const stopMarkers = [];
    const busMarkers = {}; // key: markerId

    let routePolyline = null;

    // 사이드바 데이터용
    let currentStops = [];     // /api/route 기준 정류장 목록
    let currentBuses = [];     // /api/live 기준 버스 목록 (markerId 포함)
    let lastUpdatedTime = null;
    let sidebarCollapsed = false;

    // ------------------------------------------------------------------------
    // 정류장 및 노선 경로 로딩
    // ------------------------------------------------------------------------
    function loadRouteAndStops() {
	fetch(`${API_BASE}/api/route`)     
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    console.error("Route API error:", data.error);
                    return;
                }

                const path = data.path || [];
                const stops = data.stops || [];
                currentStops = stops;

                // 1) 노선 polyline 그리기 (주황색)
                if (routePolyline) {
                    map.removeLayer(routePolyline);
                }

                if (path.length > 0) {
                    routePolyline = L.polyline(path, {
                        color: "#ff8c00",
                        weight: 5,
                        opacity: 0.7
                    }).addTo(map);

                    map.fitBounds(routePolyline.getBounds().pad(0.2));
                }

                // 2) 정류장 마커 표시
                stopMarkers.forEach(m => map.removeLayer(m));
                stopMarkers.length = 0;

                stops.forEach(stop => {
                    if (stop.lat == null || stop.lng == null) {
                        return;
                    }

                    const label = stop.arsId
                        ? stop.name + " (" + stop.arsId + ")"
                        : stop.name;

                    const marker = L.marker([stop.lat, stop.lng], { icon: stopIcon }).addTo(map);
                    marker.bindPopup(label);
                    stopMarkers.push(marker);
                });

                // 정류장 정보가 로딩되면 사이드바도 갱신
                renderSidebar();
            })
            .catch(err => {
                console.error("Failed to load route/stops:", err);
            });
    }

    // ------------------------------------------------------------------------
    // 실시간 버스 위치 로딩 (수동 새로고침)
    // ------------------------------------------------------------------------
    function updateBusPositions() {
        fetch(`${API_BASE}/api/live`)
            .then(response => response.json())
            .then(data => {
                if (!Array.isArray(data)) {
                    if (data && data.error) {
                        console.error("Live API error:", data.error);
                    } else {
                        console.error("Unexpected live data:", data);
                    }
                    return;
                }

                currentBuses = [];
                lastUpdatedTime = new Date();

                const seenIds = new Set();

                data.forEach(bus => {
                    if (bus.lat == null || bus.lng == null) {
                        return;
                    }

                    // 지도 마커와 사이드바 양쪽에서 동일하게 사용할 markerId
                    const markerId = bus.id || bus.plate || Math.random().toString(36).slice(2);
                    bus._markerId = markerId;
                    currentBuses.push(bus);
                    seenIds.add(markerId);

                    // 그룹에 따른 아이콘 선택
                    let iconToUse = busIconBlue;
                    if (bus.group === "red") {
                        iconToUse = busIconRed;
                    }

                    const coord = [bus.lat, bus.lng];
                    const label = bus.plate ? "버스 " + bus.plate : "버스";

                    if (!busMarkers[markerId]) {
                        // 새 버스 마커 생성
                        const marker = L.marker(coord, { icon: iconToUse }).addTo(map);
                        marker.bindPopup(label);
                        busMarkers[markerId] = marker;
                    } else {
                        // 기존 마커 위치 및 아이콘 업데이트
                        const marker = busMarkers[markerId];
                        marker.setLatLng(coord);
                        marker.setIcon(iconToUse);
                        marker.bindPopup(label);
                    }
                });

                // 응답에 더 이상 없는 버스는 제거
                Object.keys(busMarkers).forEach(id => {
                    if (!seenIds.has(id)) {
                        map.removeLayer(busMarkers[id]);
                        delete busMarkers[id];
                    }
                });

                // 사이드바 갱신
                renderSidebar();
            })
            .catch(err => {
                console.error("Failed to load live bus data:", err);
            });
    }

    // ------------------------------------------------------------------------
    // 사이드바 렌더링
    // ------------------------------------------------------------------------
    function renderSidebar() {
        const container = document.getElementById("sidebar-stops");
        if (!container) {
            return;
        }
        container.innerHTML = "";

        // 마지막 갱신 시각 표시
        const lastUpdatedEl = document.getElementById("last-updated");
        if (lastUpdatedEl) {
            if (lastUpdatedTime) {
                const t = lastUpdatedTime;
                const text = t.toLocaleTimeString("ko-KR", {
                    hour12: true,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                });
                lastUpdatedEl.textContent = "마지막 갱신: " + text;
            } else {
                lastUpdatedEl.textContent = "마지막 갱신: -";
            }
        }

        if (!Array.isArray(currentStops) || currentStops.length === 0) {
            return;
        }

        // 각 정류장에 버스 배치
        const stopsWithBuses = currentStops.map(stop => {
            return {
                ...stop,
                redBuses: [],
                blueBuses: [],
                highlight: !!stop.highlight
            };
        });

        currentBuses.forEach(bus => {
            if (bus.lat == null || bus.lng == null) {
                return;
            }

            let targetIndex = -1;

            // 1순위: sectOrd 기반 매핑 (API가 준 구간 순번)
            if (bus.sectOrd !== undefined && bus.sectOrd !== null) {
                const sectOrdValue = typeof bus.sectOrd === "number"
                    ? bus.sectOrd
                    : parseInt(bus.sectOrd, 10);

                if (!Number.isNaN(sectOrdValue)) {
                    let bestDiff = Infinity;

                    stopsWithBuses.forEach((stop, idx) => {
                        if (typeof stop.seq !== "number") {
                            return;
                        }
                        const diff = Math.abs(stop.seq - sectOrdValue);
                        if (diff < bestDiff) {
                            bestDiff = diff;
                            targetIndex = idx;
                        }
                    });
                }
            }

            // 2순위: sectOrd가 없거나 실패 시, 기존처럼 거리 기반으로 매핑
            if (targetIndex === -1) {
                let nearestIndex = -1;
                let bestDist = Infinity;

                stopsWithBuses.forEach((stop, idx) => {
                    if (stop.lat == null || stop.lng == null) {
                        return;
                    }
                    const dLat = bus.lat - stop.lat;
                    const dLng = bus.lng - stop.lng;
                    const dist2 = dLat * dLat + dLng * dLng;
                    if (dist2 < bestDist) {
                        bestDist = dist2;
                        nearestIndex = idx;
                    }
                });

                targetIndex = nearestIndex;
            }

            if (targetIndex >= 0) {
                const target = stopsWithBuses[targetIndex];
                if (bus.group === "red") {
                    target.redBuses.push(bus);
                } else {
                    target.blueBuses.push(bus);
                }
            }
        });

        stopsWithBuses.forEach(stop => {
            const row = document.createElement("div");
            row.className = "sidebar-stop-row";

            if (stop.highlight) {
                row.classList.add("highlight-section");
            }

            const lineCol = document.createElement("div");
            lineCol.className = "sidebar-line-col";

            const dot = document.createElement("div");
            dot.className = "sidebar-stop-dot";
            lineCol.appendChild(dot);

            // 빨간 버스 칩
            stop.redBuses.forEach(bus => {
                const chip = document.createElement("div");
                chip.className = "sidebar-bus-chip red";
                chip.textContent = bus.plate || "버스";
                chip.dataset.markerId = bus._markerId || "";
                chip.addEventListener("click", () => focusBus(bus));
                lineCol.appendChild(chip);
            });

            // 파란 버스 칩
            stop.blueBuses.forEach(bus => {
                const chip = document.createElement("div");
                chip.className = "sidebar-bus-chip blue";
                chip.textContent = bus.plate || "버스";
                chip.dataset.markerId = bus._markerId || "";
                chip.addEventListener("click", () => focusBus(bus));
                lineCol.appendChild(chip);
            });

            const infoCol = document.createElement("div");
            infoCol.className = "sidebar-stop-info";

            const nameEl = document.createElement("div");
            nameEl.className = "sidebar-stop-name";
            nameEl.textContent = stop.name || "";

            const metaEl = document.createElement("div");
            metaEl.className = "sidebar-stop-meta";
            const parts = [];
            if (stop.arsId) {
                parts.push(stop.arsId);
            }
            if (typeof stop.seq === "number") {
                parts.push("순번 " + stop.seq);
            }
            metaEl.textContent = parts.join(" / ");

            infoCol.appendChild(nameEl);
            infoCol.appendChild(metaEl);

            row.appendChild(lineCol);
            row.appendChild(infoCol);

            container.appendChild(row);
        });
    }

    // ------------------------------------------------------------------------
    // 버스 포커스 (사이드바 칩 클릭 시)
    // ------------------------------------------------------------------------
    function focusBus(bus) {
        const markerId = bus._markerId;
        if (!markerId) {
            return;
        }
        const marker = busMarkers[markerId];
        if (!marker) {
            return;
        }
        const latlng = marker.getLatLng();
        map.setView(latlng, 16, { animate: true });
        marker.openPopup();
    }

    // ------------------------------------------------------------------------
    // 사용자 위치 표시
    // ------------------------------------------------------------------------
    let userMarker = null;
    let userCircle = null;

    function locateUser() {
        if (!navigator.geolocation) {
            showToast("이 브라우저는 위치 서비스를 지원하지 않습니다.");
            return;
        }

        showToast("위치 확인 중입니다.");

        navigator.geolocation.getCurrentPosition(
            position => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const accuracy = position.coords.accuracy;

                // 지도 중심 이동
                map.setView([lat, lng], 15);

                // 기존 마커 제거
                if (userMarker) {
                    map.removeLayer(userMarker);
                }
                if (userCircle) {
                    map.removeLayer(userCircle);
                }

                // 새 사용자 마커
                userMarker = L.marker([lat, lng]).addTo(map);
                userMarker.bindPopup("현재 위치").openPopup();

                // 정확도 원
                userCircle = L.circle([lat, lng], {
                    radius: accuracy,
                    color: "#2563eb",
                    fillColor: "#2563eb",
                    fillOpacity: 0.15
                }).addTo(map);

                showToast("현재 위치를 찾았습니다.");
            },
            error => {
                console.error("Geolocation error:", error);
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        showToast("위치 권한이 거부되었습니다.");
                        break;
                    case error.POSITION_UNAVAILABLE:
                        showToast("위치 정보를 사용할 수 없습니다.");
                        break;
                    case error.TIMEOUT:
                        showToast("위치 확인 시간이 초과되었습니다.");
                        break;
                    default:
                        showToast("위치 확인 중 오류가 발생했습니다.");
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
            }
        );
    }

    // ------------------------------------------------------------------------
    // 버튼 / 시계 / 사이드바 토글
    // ------------------------------------------------------------------------
    const locateBtn = document.getElementById("locate-btn");
    if (locateBtn) {
        locateBtn.addEventListener("click", locateUser);
    }

    const refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            updateBusPositions();
        });
    }

    const toggleBtn = document.getElementById("sidebar-toggle");

    function setSidebarCollapsed(collapsed) {
        sidebarCollapsed = collapsed;

        const sidebarEl = document.getElementById("sidebar");
        if (!sidebarEl || !toggleBtn) {
            return;
        }

        if (collapsed) {
            sidebarEl.classList.add("collapsed");
            toggleBtn.textContent = "펼치기";
        } else {
            sidebarEl.classList.remove("collapsed");
            toggleBtn.textContent = "접기";
        }
    }

    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            setSidebarCollapsed(!sidebarCollapsed);
        });
    }

    function updateClock() {
        const clockEl = document.getElementById("sidebar-clock");
        if (!clockEl) {
            return;
        }
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString("ko-KR", {
            hour12: true,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    }

    updateClock();
    setInterval(updateClock, 1000);

    // ------------------------------------------------------------------------
    // 초기 로딩
    // ------------------------------------------------------------------------
    loadRouteAndStops();
    locateUser();
    updateBusPositions();
    setSidebarCollapsed(false);

    // ------------------------------------------------------------------------
    // Toast 메시지 헬퍼
    // ------------------------------------------------------------------------
    function showToast(message) {
        const toast = document.getElementById("status-msg");
        if (!toast) {
            return;
        }
        toast.textContent = message;
        toast.classList.remove("hidden");
        toast.classList.add("show");

        setTimeout(() => {
            toast.classList.remove("show");
            setTimeout(() => {
                toast.classList.add("hidden");
            }, 300);
        }, 3000);
    }
});
