import Foundation
import CoreLocation

struct LocationResult {
    var ok: Bool
    var lat: Double = 0
    var lon: Double = 0
    var name: String? = nil
    var error: String? = nil
}

/// One-shot "where am I" using macOS Location Services (asks permission the first time).
final class LocationService: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private var completion: ((LocationResult) -> Void)?
    private var requested = false
    private var askedForPermission = false
    private var timeout: DispatchWorkItem?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer   // city level is plenty for weather
    }

    /// Calls `done` on the main thread, exactly once.
    func locate(_ done: @escaping (LocationResult) -> Void) {
        if completion != nil { finish(LocationResult(ok: false, error: "Superseded by a new request")) }
        completion = done
        requested = false
        let item = DispatchWorkItem { [weak self] in
            self?.finish(LocationResult(ok: false, error: "Timed out waiting for location"))
        }
        timeout = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: item)
        proceed()
    }

    private func proceed() {
        guard completion != nil, !requested else { return }
        switch manager.authorizationStatus {
        case .notDetermined:
            if !askedForPermission {
                askedForPermission = true
                manager.requestWhenInUseAuthorization()      // the answer arrives in locationManagerDidChangeAuthorization
            }
        case .denied, .restricted:
            finish(LocationResult(ok: false, error: "Location permission denied"))
        default:
            requested = true
            manager.requestLocation()
        }
    }

    private func finish(_ result: LocationResult) {
        timeout?.cancel()
        timeout = nil
        guard let done = completion else { return }
        completion = nil
        requested = false
        done(result)
    }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        proceed()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard completion != nil, let loc = locations.last else { return }
        let lat = loc.coordinate.latitude
        let lon = loc.coordinate.longitude
        geocoder.reverseGeocodeLocation(loc) { [weak self] marks, _ in
            var name: String? = nil
            if let pm = marks?.first {
                let parts = [pm.locality ?? pm.subLocality, pm.administrativeArea ?? pm.country].compactMap { $0 }
                if !parts.isEmpty { name = parts.joined(separator: ", ") }
            }
            self?.finish(LocationResult(ok: true, lat: lat, lon: lon, name: name))
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(LocationResult(ok: false, error: error.localizedDescription))
    }
}
