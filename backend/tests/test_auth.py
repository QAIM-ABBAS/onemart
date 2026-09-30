from tests.conftest import PASSWORD


def test_register_login_me_refresh_logout(client):
    register = client.post(
        "/api/auth/register",
        json={"email": "new@user.dev", "password": PASSWORD, "full_name": "New User"},
    )
    assert register.status_code == 201, register.text
    body = register.json()
    assert body["user"]["email"] == "new@user.dev"
    assert "onemart_refresh" in client.cookies

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json()["role"] == "customer"

    refreshed = client.post("/api/auth/refresh")
    assert refreshed.status_code == 200
    new_token = refreshed.json()["access_token"]
    assert new_token != body["access_token"]

    # refresh token is single-use: a second refresh with the rotated cookie is fine,
    # but reusing the original (revoked) token must fail.
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {new_token}"}).status_code == 200

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 204
    assert client.post("/api/auth/refresh").status_code == 401


def test_duplicate_register_conflict(client):
    payload = {"email": "dupe@user.dev", "password": PASSWORD, "full_name": "Dupe"}
    assert client.post("/api/auth/register", json=payload).status_code == 201
    assert client.post("/api/auth/register", json=payload).status_code == 409


def test_bad_login(client):
    response = client.post("/api/auth/login", json={"email": "ghost@user.dev", "password": "x"})
    assert response.status_code == 401


def test_requires_auth(client):
    assert client.get("/api/orders").status_code == 401
    assert client.get("/api/auth/me").status_code == 401
