UHD Connect(tm) Samples

The samples herein consist of a set of JSON files, one scenario per subfolder, and the
instructions to use them with curl, below.

The samples are intended to be used with the UHD Connect(tm) APIs, which consists of two endpoints:

1. https://<ip-or-hostname-of-unit>/connect/api/v1/... - This endpoint is used to configure connectivity
   between ports on the device

2. https://<ip-or-hostname-of-unit>/... - This endpoint is used to configure bgp service instances running
   inside the UHD Connect(tm) appliance

Links to the API documentation can be found in the top-level Getting Started Guide that is available by
pointing your browser to https://<ip-or-hostname-of-unit>/

For a full list of scenarios covered by these samples, with a description of each and a link to its
JSON file, see the Sample Configurations page: https://<ip-or-hostname-of-unit>/Sample_Configs.html

Applying a sample

    Any sample can be applied by running the following command, substituting the path to the scenario's
    JSON file (e.g. encap_single_vlan_vxlan/encap_single_vlan_vxlan.json):

    curl -k -X POST -H "Content-Type: application/json" -d @<scenario>/<scenario>.json https://<ip-or-hostname-of-unit>/connect/api/v1/config

    Additionally port metrics can be obtained via the following command:

    curl -k -X POST -H "Content-Type: application/json" https://<ip-or-hostname-of-unit>/connect/api/v1/metrics/operations/query

    Metrics can be cleared (zeroed) via the following command:

    curl -k -X POST -H "Content-Type: application/json" https://<ip-or-hostname-of-unit>/connect/api/v1/metrics/operations/clear
