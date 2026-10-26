-- Branch pins moved to where their staff actually punch every day (median of the last 14 days of phone punches):
-- central kitchen was ~21 km off, Jabriya ~700 m, Sabah Al-Salem ~126 m. Recent punches re-checked against the new pins.
-- Phone check-in now requires the phone's location ('location required').
update branches set latitude = 29.196771, longitude = 48.050031 where id = '968f53f0-ad0c-4552-99d4-60df314d73ed';
update branches set latitude = 29.320493, longitude = 48.016465 where id = '95a306d3-c849-4da6-897c-582388b341cf';
update branches set latitude = 29.263193, longitude = 48.082481 where id = '522f7515-f291-40cc-a7cc-c1d744cab02a';
-- check_in(): see the applied migration fix_branch_locations_require_phone_location (raises 'location required' when p_lat/p_lng is null)
